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

    // Create client with explicit session ID
    gatewayClient = new Client(
      { name: "e2e-test-client", version: "1.0.0" },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${gatewayPort}/mcp`),
      {
        requestInit: {
          headers: {
            "mcp-session-id": "e2e-test-session",
          },
        },
      },
    );
    await gatewayClient.connect(transport);
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

    it("should get tool details for add tool", async () => {
      const result = await gatewayClient.callTool({
        name: "tool-details",
        arguments: {
          luaServerName: "calculator",
          luaToolName: "add",
        },
      });

      expect(result.content).toHaveLength(1);
      const content = (
        result.content as Array<TextContent | ImageContent | EmbeddedResource>
      )[0]!;
      expect(content.type).toBe("text");

      if (content.type === "text") {
        expect(content.text).toContain("Add two numbers");
        expect(content.text).toContain("Input Schema:");
      }
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

      expect(result.content).toHaveLength(1);
      const content = (
        result.content as Array<TextContent | ImageContent | EmbeddedResource>
      )[0]!;
      expect(content.type).toBe("text");

      if (content.type === "text") {
        expect(content.text).toContain("2 + 3 = 5");
      }
    });

    it("should execute Lua script calling calculator tools", async () => {
      const script = `
        local res = calculator.add({ a = 10, b = 20 }):await()
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
        expect(content.text).toContain("10 + 20 = 30");
      }
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

      // The result might be text or structured content
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

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      const content = (
        result.content as Array<TextContent | ImageContent | EmbeddedResource>
      )[0]!;
      if (content.type === "text") {
        expect(content.text).toContain("Cannot divide by zero");
      }
    });

    it("should handle invalid server names", async () => {
      const result = await gatewayClient.callTool({
        name: "list-server-tools",
        arguments: { luaServerName: "nonexistent" },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      const content = (
        result.content as Array<TextContent | ImageContent | EmbeddedResource>
      )[0]!;
      if (content.type === "text") {
        expect(content.text).toContain("Server 'nonexistent' not found");
      }
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

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      const content = (
        result.content as Array<TextContent | ImageContent | EmbeddedResource>
      )[0]!;
      if (content.type === "text") {
        expect(content.text).toContain("error");
      }
    });
  });
});
