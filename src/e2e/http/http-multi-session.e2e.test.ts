import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { allocatePort } from "../helpers/port-manager.js";
import { generateHttpTestConfig } from "../helpers/test-config-generator.js";
import { HttpServerManager } from "../helpers/http-server-manager.js";
import { ToyServerManager } from "../helpers/toy-server-manager.js";
import { createGatewayClient } from "../helpers/client-helpers.js";
import {
  getTextContent,
  assertTextContains,
  assertAllSucceeded,
} from "../helpers/test-assertions.js";

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

    // Create clients - each will get a unique server-generated session ID
    client1 = await createGatewayClient({
      gatewayPort,
      clientName: "e2e-client-1",
    });

    client2 = await createGatewayClient({
      gatewayPort,
      clientName: "e2e-client-2",
    });
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

      const text1 = getTextContent(result1).text;
      const text2 = getTextContent(result2).text;

      // Both should list the same servers
      expect(text1).toContain("Available MCP Servers: 1");
      expect(text2).toContain("Available MCP Servers: 1");
      expect(text1).toContain("📦 calculator");
      expect(text2).toContain("📦 calculator");

      // Both should have a session ID (server-generated UUIDs)
      expect(text1).toMatch(/Session: [\w-]+/);
      expect(text2).toMatch(/Session: [\w-]+/);

      // Extract session IDs and verify they're different
      const session1Match = text1.match(/Session: ([\w-]+)/);
      const session2Match = text2.match(/Session: ([\w-]+)/);
      expect(session1Match).not.toBeNull();
      expect(session2Match).not.toBeNull();
      expect(session1Match![1]).not.toBe(session2Match![1]);
    });

    it("should execute Lua scripts independently in each session", async () => {
      // Client 1 executes a calculation
      const script1 = `
        local res = calculator.add({ a = 100, b = 200 }):await()
        result(res)
      `;

      const result1 = await client1.callTool({
        name: "execute",
        arguments: { script: script1 },
      });

      // Client 2 executes a different calculation
      const script2 = `
        local res = calculator.multiply({ a = 5, b = 10 }):await()
        result(res)
      `;

      const result2 = await client2.callTool({
        name: "execute",
        arguments: { script: script2 },
      });

      // Verify that both executions succeeded with different results
      assertTextContains(result1, "100 + 200 = 300");
      assertTextContains(result2, "5 * 10 = 50");
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

      // Both should succeed with the same calculation result
      assertTextContains(result1, "1 + 1 = 2");
      assertTextContains(result2, "1 + 1 = 2");
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
      assertAllSucceeded(results);
    });
  });
});
