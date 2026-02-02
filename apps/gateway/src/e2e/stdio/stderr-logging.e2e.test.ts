import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  TextContent,
  ImageContent,
  EmbeddedResource,
} from "@modelcontextprotocol/sdk/types.js";
import { generateStdioTestConfig } from "../helpers/test-config-generator.js";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { getServerLogDir } from "../../utils/log-paths.js";

/**
 * Waits for upstream servers to be available by polling list-servers.
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

      const content = result.content as Array<{ type: string; text?: string }>;
      const firstContent = content[0];
      if (firstContent && "text" in firstContent && firstContent.text) {
        const text = firstContent.text;
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

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    `Expected ${expectedServerCount} servers but they did not become ready within ${timeoutMs}ms`,
  );
}

describe("Stderr Logging E2E", () => {
  let gatewayClient: Client;
  let configCleanup: () => void;
  let transport: StdioClientTransport;
  const serverLogDir = getServerLogDir();

  beforeAll(async () => {
    // Clean up any existing log files from previous test runs
    if (existsSync(serverLogDir)) {
      const files = readdirSync(serverLogDir);
      for (const file of files) {
        if (file.startsWith("stderr-server")) {
          rmSync(resolve(serverLogDir, file), { force: true });
        }
      }
    }

    // Generate stdio config with the stderr test server
    const configResult = generateStdioTestConfig({
      transport: "stdio",
      mcpClients: {
        "stderr-server": {
          type: "stdio",
          command: "node",
          args: [
            resolve(
              process.cwd(),
              "apps/gateway/dist/e2e/fixtures/toy-servers/stderr-server.js",
            ),
          ],
        },
      },
    });
    configCleanup = configResult.cleanup;

    // Create client with stdio transport to gateway
    gatewayClient = new Client(
      { name: "e2e-stderr-client", version: "1.0.0" },
      { capabilities: {} },
    );

    // Create transport that spawns gateway process
    transport = new StdioClientTransport({
      command: "node",
      args: [resolve(process.cwd(), "apps/gateway/dist/index.js")],
      env: {
        ...process.env,
        CONFIG_PATH: configResult.configPath,
      },
    });

    await gatewayClient.connect(transport);

    // Wait for the stderr-server to be ready
    await waitForServersReady(gatewayClient, 1);
  }, 60000);

  afterAll(async () => {
    await gatewayClient?.close();
    configCleanup?.();
  });

  describe("Server Stderr Capture", () => {
    it("should list the stderr-server", async () => {
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
        expect(content.text).toContain("stderr_server");
      }
    });

    it("should be able to call echo tool on stderr-server", async () => {
      const script = `
        local res = stderr_server.echo({ message = "hello from e2e test" }):await()
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
        expect(content.text).toContain("hello from e2e test");
      }
    });

    it("should be able to trigger stderr output via tool call", async () => {
      const script = `
        local res = stderr_server.write_to_stderr({ message = "test message from lua" }):await()
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
        expect(content.text).toContain(
          "Wrote to stderr: test message from lua",
        );
      }
    });

    it("should create log file for stderr-server", async () => {
      // The log file should have been created when the server started
      // In stdio mode, the session ID is "default", so the log file will be
      // stderr-server-default.log
      const expectedLogFileName = "stderr-server-default.log";
      const logFilePath = resolve(serverLogDir, expectedLogFileName);

      // Give some time for the file system to catch up
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(existsSync(logFilePath)).toBe(true);
    });

    it("should capture stderr output in the log file", async () => {
      const expectedLogFileName = "stderr-server-default.log";
      const logFilePath = resolve(serverLogDir, expectedLogFileName);

      // Give some time for stderr output to be flushed
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(existsSync(logFilePath)).toBe(true);

      const logContent = readFileSync(logFilePath, "utf-8");

      // Should contain startup messages
      expect(logContent).toContain("[stderr-test] Server starting up");
      expect(logContent).toContain("[stderr-test] Server ready");
    });

    it("should capture tool-triggered stderr output in the log file", async () => {
      // First trigger a stderr write via the tool
      const script = `
        local res = stderr_server.write_to_stderr({ message = "captured message" }):await()
        result(res)
      `;

      await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // Give time for output to flush
      await new Promise((resolve) => setTimeout(resolve, 500));

      const expectedLogFileName = "stderr-server-default.log";
      const logFilePath = resolve(serverLogDir, expectedLogFileName);
      const logContent = readFileSync(logFilePath, "utf-8");

      // Should contain the message from the tool call
      expect(logContent).toContain(
        "[stderr-test] Tool called: captured message",
      );
    });
  });
});
