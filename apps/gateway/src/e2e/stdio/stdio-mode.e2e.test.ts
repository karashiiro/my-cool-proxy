import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  type TextContent,
  type ImageContent,
  type EmbeddedResource,
} from "@modelcontextprotocol/sdk/types.js";
import { generateStdioTestConfig } from "../helpers/test-config-generator.js";
import { resolve } from "node:path";

/**
 * Waits for upstream servers to be available by polling list-servers.
 * This is necessary because upstream MCP clients are created asynchronously
 * after the downstream client connects and its capabilities are captured.
 *
 * @param client - The MCP client to poll
 * @param expectedServerCount - Number of servers to wait for
 * @param timeoutMs - Maximum time to wait
 */
async function waitForServersReady(
  client: Client,
  expectedServerCount: number,
  timeoutMs = 5000,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = await client.callTool({
        name: "list-servers",
        arguments: {},
      });

      // Check if all expected servers are available
      const content = result.content as Array<{ type: string; text?: string }>;
      const firstContent = content[0];
      if (firstContent && "text" in firstContent && firstContent.text) {
        const text = firstContent.text;
        // Wait until we have the expected number of servers
        const match = text.match(/Available MCP Servers: (\d+)/);
        if (
          match &&
          match[1] &&
          parseInt(match[1], 10) >= expectedServerCount
        ) {
          return;
        }
      }
    } catch {
      // Ignore errors during polling
    }

    // Wait a bit before retrying
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    `Expected ${expectedServerCount} servers but they did not become ready within ${timeoutMs}ms`,
  );
}

describe("Stdio Mode E2E", () => {
  let gatewayClient: Client;
  let configCleanup: () => void;

  beforeAll(async () => {
    // Generate stdio config with stdio toy servers
    const configResult = generateStdioTestConfig({
      transport: "stdio",
      mcpClients: {
        calculator: {
          type: "stdio",
          command: "node",
          args: [
            resolve(
              process.cwd(),
              "apps/gateway/dist/e2e/fixtures/toy-servers/calculator-server.js",
            ),
          ],
        },
        "data-server": {
          type: "stdio",
          command: "node",
          args: [
            resolve(
              process.cwd(),
              "apps/gateway/dist/e2e/fixtures/toy-servers/data-server.js",
            ),
          ],
        },
      },
    });
    configCleanup = configResult.cleanup;

    // Create client with stdio transport to gateway
    gatewayClient = new Client(
      { name: "e2e-stdio-client", version: "1.0.0" },
      { capabilities: {} },
    );

    // Create transport that spawns gateway process
    const transport = new StdioClientTransport({
      command: "node",
      args: [resolve(process.cwd(), "apps/gateway/dist/index.js")],
      env: {
        ...process.env,
        CONFIG_PATH: configResult.configPath,
      },
    });

    await gatewayClient.connect(transport);

    // Wait for upstream servers to be ready
    // This is necessary because upstream clients are created asynchronously
    // We expect 2 servers: calculator and data-server
    await waitForServersReady(gatewayClient, 2);
  }, 60000);

  afterAll(async () => {
    await gatewayClient?.close();
    configCleanup?.();
  });

  describe("Basic Execution", () => {
    it("should list servers", async () => {
      const result = await gatewayClient.callTool({
        name: "list-servers",
        arguments: {},
      });

      expect(result.content).toHaveLength(1);
      const content = (
        result.content as Array<TextContent | ImageContent | EmbeddedResource>
      )[0]!;
      expect(content.type).toBe("text");

      if (content.type === "text") {
        // The tool returns formatted text, not JSON
        expect(content.text).toContain("calculator");
        expect(content.text).toContain("data-server");
      }
    });

    it("should execute Lua script calling calculator", async () => {
      const script = `
        local res = calculator.add({ a = 15, b = 25 }):await()
        result(res)
      `;

      const executeResult = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(executeResult.content).toHaveLength(1);
      const content = (
        executeResult.content as Array<
          TextContent | ImageContent | EmbeddedResource
        >
      )[0]!;
      expect(content.type).toBe("text");

      if (content.type === "text") {
        expect(content.text).toContain("15 + 25 = 40");
      }
    });

    it("should list tools from calculator server", async () => {
      const result = await gatewayClient.callTool({
        name: "list-server-tools",
        arguments: { luaServerName: "calculator" },
      });

      expect(result.content).toHaveLength(1);
      const content = (
        result.content as Array<TextContent | ImageContent | EmbeddedResource>
      )[0]!;
      expect(content.type).toBe("text");

      if (content.type === "text") {
        // The tool returns formatted text, not JSON
        expect(content.text).toContain("add");
        expect(content.text).toContain("multiply");
        expect(content.text).toContain("subtract");
        expect(content.text).toContain("divide");
      }
    });
  });

  describe("Stdio-Specific Behavior", () => {
    it("should use single session (default)", async () => {
      // In stdio mode, all clients are initialized upfront for the "default" session
      // This test verifies that tools are available immediately

      const script = `
        local res = calculator.multiply({ a = 7, b = 8 }):await()
        result(res)
      `;

      const executeResult = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(executeResult.content).toHaveLength(1);
      const content = (
        executeResult.content as Array<
          TextContent | ImageContent | EmbeddedResource
        >
      )[0]!;
      expect(content.type).toBe("text");

      if (content.type === "text") {
        expect(content.text).toContain("7 * 8 = 56");
      }
    });

    it("should handle stdio child processes (data-server tools)", async () => {
      // Verify that stdio toy servers are spawned correctly
      const script = `
        local files = data_server.list_files({}):await()
        result(files)
      `;

      const executeResult = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(executeResult.content).toHaveLength(1);
      const content = (
        executeResult.content as Array<
          TextContent | ImageContent | EmbeddedResource
        >
      )[0]!;
      expect(content.type).toBe("text");

      if (content.type === "text") {
        expect(content.text).toContain("file://");
      }
    });

    it("should read resources from stdio servers", async () => {
      const resources = await gatewayClient.listResources();

      expect(resources.resources).toBeDefined();
      expect(Array.isArray(resources.resources)).toBe(true);

      // Should have resources from data-server
      const dataServerResources = resources.resources.filter((r) =>
        r.uri.startsWith("mcp://data-server/"),
      );

      expect(dataServerResources.length).toBeGreaterThan(0);
    });
  });

  describe("Multi-Server Coordination", () => {
    it("should call tools from both stdio servers in one script", async () => {
      const script = `
        local calc = calculator.subtract({ a = 100, b = 25 }):await()
        local data = data_server.read_file({ filename = "test-data.json" }):await()
        
        result({
          calculation = calc,
          has_data = data ~= nil
        })
      `;

      const executeResult = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(executeResult.content).toHaveLength(1);
      expect(
        (
          executeResult.content as Array<
            TextContent | ImageContent | EmbeddedResource
          >
        )[0]!.type,
      ).toMatch(/text|resource/);
    });
  });
});
