import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  TextContent,
  ImageContent,
  EmbeddedResource,
} from "@modelcontextprotocol/sdk/types.js";
import { allocatePort } from "../helpers/port-manager.js";
import { generateHttpTestConfig } from "../helpers/test-config-generator.js";
import { HttpServerManager } from "../helpers/http-server-manager.js";
import { ToyServerManager } from "../helpers/toy-server-manager.js";

describe("HTTP Multi-Session E2E", () => {
  let gatewayPort: number;
  let calculatorPort: number;
  let gatewayManager: HttpServerManager;
  let toyServers: ToyServerManager;
  let client1: Client;
  let client2: Client;
  let configCleanup: () => void;

  beforeAll(async () => {
    // Allocate ports
    gatewayPort = await allocatePort();
    calculatorPort = await allocatePort();

    // Start toy servers
    toyServers = new ToyServerManager();
    await toyServers.startHttp("calculator", calculatorPort);

    // Generate config
    const configResult = generateHttpTestConfig({
      port: gatewayPort,
      host: "localhost",
      mcpClients: {
        calculator: {
          type: "http",
          url: `http://localhost:${calculatorPort}/mcp`,
        },
      },
    });
    configCleanup = configResult.cleanup;

    // Set CONFIG_PATH for the gateway to use
    process.env.CONFIG_PATH = configResult.configPath;

    // Start gateway
    gatewayManager = new HttpServerManager();
    await gatewayManager.start({
      transport: "http",
      port: gatewayPort,
      host: "localhost",
      mcpClients: {
        calculator: {
          type: "http",
          url: `http://localhost:${calculatorPort}/mcp`,
        },
      },
    });

    // Create client 1 with session ID "session-1"
    client1 = new Client(
      { name: "e2e-client-1", version: "1.0.0" },
      { capabilities: {} },
    );
    const transport1 = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${gatewayPort}/mcp`),
      {
        requestInit: {
          headers: {
            "mcp-session-id": "session-1",
          },
        },
      },
    );
    await client1.connect(transport1);

    // Create client 2 with session ID "session-2"
    client2 = new Client(
      { name: "e2e-client-2", version: "1.0.0" },
      { capabilities: {} },
    );
    const transport2 = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${gatewayPort}/mcp`),
      {
        requestInit: {
          headers: {
            "mcp-session-id": "session-2",
          },
        },
      },
    );
    await client2.connect(transport2);
  }, 30000);

  afterAll(async () => {
    await client1?.close();
    await client2?.close();
    await gatewayManager?.stop();
    await toyServers?.stopAll();
    configCleanup?.();
  });

  describe("Session Isolation", () => {
    it("should handle two clients with different session IDs", async () => {
      // Both clients should be able to list servers
      const result1 = await client1.callTool({
        name: "list-servers",
        arguments: {},
      });
      const result2 = await client2.callTool({
        name: "list-servers",
        arguments: {},
      });

      expect(result1.content).toHaveLength(1);
      expect(result2.content).toHaveLength(1);

      // Both should see the same servers (but with different session IDs)
      const content1 = (
        result1.content as Array<TextContent | ImageContent | EmbeddedResource>
      )[0]!;
      const content2 = (
        result2.content as Array<TextContent | ImageContent | EmbeddedResource>
      )[0]!;

      // Verify both have text content
      expect(content1.type).toBe("text");
      expect(content2.type).toBe("text");

      if (content1.type === "text" && content2.type === "text") {
        // Both should list the same number of servers
        expect(content1.text).toContain("Available MCP Servers: 1");
        expect(content2.text).toContain("Available MCP Servers: 1");

        // Both should see the calculator server
        expect(content1.text).toContain("📦 calculator");
        expect(content2.text).toContain("📦 calculator");

        // But they should show different session IDs
        expect(content1.text).toContain("Session: session-1");
        expect(content2.text).toContain("Session: session-2");
      }
    });

    it("should execute Lua scripts independently in each session", async () => {
      // Client 1 executes a calculation
      const script1 = `
        local res = calculator.add({ a = 100, b = 200 }):await()
        result(res)
      `;

      const executeResult1 = await client1.callTool({
        name: "execute",
        arguments: { script: script1 },
      });

      // Client 2 executes a different calculation
      const script2 = `
        local res = calculator.multiply({ a = 5, b = 10 }):await()
        result(res)
      `;

      const executeResult2 = await client2.callTool({
        name: "execute",
        arguments: { script: script2 },
      });

      // Verify that both executions succeeded and returned different results
      expect(executeResult1.content).toHaveLength(1);
      expect(executeResult2.content).toHaveLength(1);

      const content1 = (
        executeResult1.content as Array<
          TextContent | ImageContent | EmbeddedResource
        >
      )[0]!;
      const content2 = (
        executeResult2.content as Array<
          TextContent | ImageContent | EmbeddedResource
        >
      )[0]!;

      if (content1.type === "text") {
        expect(content1.text).toContain("100 + 200 = 300");
      }

      if (content2.type === "text") {
        expect(content2.text).toContain("5 * 10 = 50");
      }
    });

    it("should maintain separate client pools per session", async () => {
      // This test verifies that each session gets its own set of MCP clients
      // by executing tools from both sessions and ensuring they don't interfere

      const script = `
        local tools = calculator.add({ a = 1, b = 1 }):await()
        result(tools)
      `;

      // Execute in parallel from both clients
      const [result1, result2] = await Promise.all([
        client1.callTool({ name: "execute", arguments: { script } }),
        client2.callTool({ name: "execute", arguments: { script } }),
      ]);

      // Both should succeed
      expect(result1.content).toHaveLength(1);
      expect(result2.content).toHaveLength(1);

      // Both should have the same result (1 + 1 = 2)
      const content1 = (
        result1.content as Array<TextContent | ImageContent | EmbeddedResource>
      )[0]!;
      const content2 = (
        result2.content as Array<TextContent | ImageContent | EmbeddedResource>
      )[0]!;

      if (content1.type === "text" && content2.type === "text") {
        expect(content1.text).toContain("1 + 1 = 2");
        expect(content2.text).toContain("1 + 1 = 2");
      }
    });
  });

  describe("Concurrent Sessions", () => {
    it("should handle concurrent tool calls from multiple sessions", async () => {
      const promises = [];

      // Client 1 makes 3 calls
      for (let i = 0; i < 3; i++) {
        promises.push(
          client1.callTool({
            name: "execute",
            arguments: {
              script: `result(calculator.add({ a = ${i}, b = ${i + 1} }):await())`,
            },
          }),
        );
      }

      // Client 2 makes 3 calls
      for (let i = 0; i < 3; i++) {
        promises.push(
          client2.callTool({
            name: "execute",
            arguments: {
              script: `result(calculator.multiply({ a = ${i + 1}, b = 2 }):await())`,
            },
          }),
        );
      }

      // All calls should succeed
      const results = await Promise.all(promises);

      expect(results).toHaveLength(6);
      results.forEach((result) => {
        expect(result.content).toHaveLength(1);
      });
    });
  });
});
