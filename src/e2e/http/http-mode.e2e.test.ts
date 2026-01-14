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
  assertTextContainsAll,
  assertIsError,
} from "../helpers/test-assertions.js";

describe("HTTP Mode E2E", () => {
  let gatewayPort: number;
  let calculatorPort: number;
  let dataPort: number;
  let gatewayManager: HttpServerManager;
  let toyServers: ToyServerManager;
  let gatewayClient: Client;
  let configCleanup: () => void;

  beforeAll(async () => {
    // Allocate ports
    gatewayPort = await allocatePort();
    calculatorPort = await allocatePort();
    dataPort = await allocatePort();

    // Start toy servers
    toyServers = new ToyServerManager();
    await toyServers.startHttp("calculator", calculatorPort);
    await toyServers.startHttp("data", dataPort);

    // Generate config
    const configResult = generateHttpTestConfig({
      port: gatewayPort,
      host: "localhost",
      mcpClients: {
        calculator: {
          type: "http",
          url: `http://localhost:${calculatorPort}/mcp`,
        },
        "data-server": {
          type: "http",
          url: `http://localhost:${dataPort}/mcp`,
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
        "data-server": {
          type: "http",
          url: `http://localhost:${dataPort}/mcp`,
        },
      },
    });

    // Create client - session is managed automatically by the server
    gatewayClient = await createGatewayClient({
      gatewayPort,
      clientName: "e2e-test-client",
    });
  }, 30000);

  afterAll(async () => {
    await gatewayClient?.close();
    await gatewayManager?.stop();
    await toyServers?.stopAll();
    configCleanup?.();
  });

  describe("Full MCP Protocol Flow", () => {
    it("should list available servers", async () => {
      const result = await gatewayClient.callTool({
        name: "list-servers",
        arguments: {},
      });

      assertTextContainsAll(result, ["calculator", "data-server"]);
    });

    it("should list tools from calculator server", async () => {
      const result = await gatewayClient.callTool({
        name: "list-server-tools",
        arguments: { luaServerName: "calculator" },
      });

      assertTextContainsAll(result, ["add", "multiply", "subtract", "divide"]);
    });

    it("should get tool details for add tool", async () => {
      const result = await gatewayClient.callTool({
        name: "tool-details",
        arguments: {
          luaServerName: "calculator",
          luaToolName: "add",
        },
      });

      assertTextContainsAll(result, ["Add two numbers", "Input Schema:"]);
    });

    it("should inspect tool response with sample args", async () => {
      const result = await gatewayClient.callTool({
        name: "inspect-tool-response",
        arguments: {
          luaServerName: "calculator",
          luaToolName: "add",
          sampleArgs: { a: 2, b: 3 },
        },
      });

      assertTextContains(result, "2 + 3 = 5");
    });

    it("should execute Lua script calling calculator tools", async () => {
      const script = `
        local res = calculator.add({ a = 10, b = 20 }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      assertTextContains(result, "10 + 20 = 30");
    });
  });

  describe("Multi-Step Lua Scripts", () => {
    it("should execute script with multiple tool calls", async () => {
      const script = `
        local sum_res = calculator.add({ a = 5, b = 7 }):await()
        local product_res = calculator.multiply({ a = 2, b = 3 }):await()
        local quotient_res = calculator.divide({ a = 10, b = 2 }):await()

        result({
          sum = sum_res,
          product = product_res,
          quotient = quotient_res
        })
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      const content = getTextContent(result);
      expect(content.type).toMatch(/text|resource/);
    });

    it("should execute script calling tools from different servers", async () => {
      const script = `
        local math_res = calculator.multiply({ a = 4, b = 5 }):await()
        local files_res = data_server.list_files({}):await()

        result({
          calculation = math_res,
          files_list = files_res
        })
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      const content = getTextContent(result);
      expect(content.type).toMatch(/text|resource/);
    });
  });

  describe("Resource Aggregation", () => {
    it("should list resources from all servers", async () => {
      const resources = await gatewayClient.listResources();

      expect(resources.resources).toBeDefined();
      expect(Array.isArray(resources.resources)).toBe(true);

      // Should have resources from data-server (namespaced)
      const dataServerResources = resources.resources.filter((r) =>
        r.uri.startsWith("mcp://data-server/"),
      );

      expect(dataServerResources.length).toBeGreaterThan(0);

      // Check for specific resources
      const testDataResource = resources.resources.find((r) =>
        r.uri.includes("test-data.json"),
      );
      expect(testDataResource).toBeDefined();
    });

    it("should read resource via namespaced URI", async () => {
      const uri = "mcp://data-server/file:///test-data.json";

      const result = await gatewayClient.readResource({ uri });

      expect(result.contents).toHaveLength(1);
      const content = result.contents[0]!;

      expect(content.uri).toBe(uri);
      if ("text" in content && content.text !== undefined) {
        expect(content.text).toContain("users");
        expect(content.text).toContain("Alice");
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle tool execution errors gracefully", async () => {
      const script = `
        local res = calculator.divide({ a = 10, b = 0 }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      assertIsError(result, "Cannot divide by zero");
    });

    it("should handle invalid server names", async () => {
      const result = await gatewayClient.callTool({
        name: "list-server-tools",
        arguments: { luaServerName: "nonexistent" },
      });

      assertIsError(result, "Server 'nonexistent' not found");
    });

    it("should handle Lua script errors", async () => {
      const script = `
        -- This will cause a Lua error
        error("Test error message")
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      assertIsError(result, "error");
    });
  });
});
