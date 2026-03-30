import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  type TextContent,
  type ImageContent,
  type EmbeddedResource,
} from "@modelcontextprotocol/sdk/types.js";
import { generateStdioTestConfig } from "../helpers/test-config-generator.js";
import {
  waitForServersReady,
  inspectAllTools,
} from "../helpers/client-helpers.js";
import { resolve } from "node:path";

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
    await inspectAllTools(gatewayClient);
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
      const content0 = (
        result.content as Array<TextContent | ImageContent | EmbeddedResource>
      )[0];
      if (!content0)
        throw new Error("expected result.content[0] to be defined");
      expect(content0.type).toBe("text");

      if (content0.type === "text") {
        // The tool returns formatted text, not JSON
        expect(content0.text).toContain("calculator");
        expect(content0.text).toContain("data-server");
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
      const content1 = (
        executeResult.content as Array<
          TextContent | ImageContent | EmbeddedResource
        >
      )[0];
      if (!content1)
        throw new Error("expected executeResult.content[0] to be defined");
      expect(content1.type).toBe("text");

      if (content1.type === "text") {
        expect(content1.text).toContain("15 + 25 = 40");
      }
    });

    it("should list tools from calculator server", async () => {
      const result = await gatewayClient.callTool({
        name: "list-server-tools",
        arguments: { luaServerName: "calculator" },
      });

      expect(result.content).toHaveLength(1);
      const content2 = (
        result.content as Array<TextContent | ImageContent | EmbeddedResource>
      )[0];
      if (!content2)
        throw new Error("expected result.content[0] to be defined");
      expect(content2.type).toBe("text");

      if (content2.type === "text") {
        // The tool returns formatted text, not JSON
        expect(content2.text).toContain("add");
        expect(content2.text).toContain("multiply");
        expect(content2.text).toContain("subtract");
        expect(content2.text).toContain("divide");
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
      const content3 = (
        executeResult.content as Array<
          TextContent | ImageContent | EmbeddedResource
        >
      )[0];
      if (!content3)
        throw new Error("expected executeResult.content[0] to be defined");
      expect(content3.type).toBe("text");

      if (content3.type === "text") {
        expect(content3.text).toContain("7 * 8 = 56");
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
      const content4 = (
        executeResult.content as Array<
          TextContent | ImageContent | EmbeddedResource
        >
      )[0];
      if (!content4)
        throw new Error("expected executeResult.content[0] to be defined");
      expect(content4.type).toBe("text");

      if (content4.type === "text") {
        expect(content4.text).toContain("file://");
      }
    });

    it("should read resources from stdio servers", async () => {
      const resources = await gatewayClient.listResources();

      expect(resources.resources).toBeDefined();
      expect(Array.isArray(resources.resources)).toBe(true);

      // Should have resources with original URIs (no gw:// namespacing)
      expect(resources.resources.length).toBeGreaterThan(0);
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
      const content5 = (
        executeResult.content as Array<
          TextContent | ImageContent | EmbeddedResource
        >
      )[0];
      if (!content5)
        throw new Error("expected executeResult.content[0] to be defined");
      expect(content5.type).toMatch(/text|resource/);
    });
  });
});
