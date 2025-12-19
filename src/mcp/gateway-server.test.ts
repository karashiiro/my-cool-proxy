import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MCPGatewayServer } from "./gateway-server.js";
import { WasmoonRuntime } from "../lua/runtime.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  CallToolResult,
  Resource,
  ReadResourceResult,
  GetPromptResult,
  ContentBlock,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  ILogger,
  ILuaRuntime,
  IMCPClientManager,
} from "../types/interfaces.js";
import * as z from "zod";
import { MCPClientSession } from "./client-session.js";
import { ToolDiscoveryService } from "./tool-discovery-service.js";
import { ResourceAggregationService } from "./resource-aggregation-service.js";
import { PromptAggregationService } from "./prompt-aggregation-service.js";
import { MCPFormatterService } from "./mcp-formatter-service.js";
import { ExecuteLuaTool } from "../tools/execute-lua-tool.js";
import { ListServersTool } from "../tools/list-servers-tool.js";
import { ListServerToolsTool } from "../tools/list-server-tools-tool.js";
import { ToolDetailsTool } from "../tools/tool-details-tool.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import type { IToolRegistry } from "../tools/tool-registry.js";

// Mock logger
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

// Mock client manager
const createMockClientManager = (
  clients: Map<string, MCPClientSession>,
): IMCPClientManager => ({
  addHttpClient: vi.fn(),
  addStdioClient: vi.fn(),
  getClient: vi.fn(),
  getClientsBySession: vi.fn(() => clients),
  setResourceListChangedHandler: vi.fn(),
  setPromptListChangedHandler: vi.fn(),
  close: vi.fn(),
});

// Helper to create a tool registry with all tools
const createToolRegistry = (
  luaRuntime: ILuaRuntime,
  clientManager: IMCPClientManager,
  logger: ILogger,
): IToolRegistry => {
  const toolDiscovery = new ToolDiscoveryService(
    clientManager,
    logger,
    new MCPFormatterService(),
  );

  const registry = new ToolRegistry();
  registry.register(new ExecuteLuaTool(luaRuntime, clientManager, logger));
  registry.register(new ListServersTool(toolDiscovery));
  registry.register(new ListServerToolsTool(toolDiscovery));
  registry.register(new ToolDetailsTool(toolDiscovery));

  return registry;
};

// Helper to create a test MCP server with tools
async function createTestServer(
  name: string,
  tools: Array<{
    name: string;
    description: string;
    handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
  }>,
): Promise<{ server: McpServer; client: MCPClientSession }> {
  const server = new McpServer(
    {
      name,
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Register tools
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: z.any(), // Accept any arguments
      },
      async (args: Record<string, unknown>) => {
        return await tool.handler(args);
      },
    );
  }

  // Create linked transports
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  // Connect server
  await server.connect(serverTransport);

  // Create and connect client
  const client = new Client(
    {
      name: "test-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  await client.connect(clientTransport);

  // Wrap in MCPClientSession
  const mcpClientSession = new MCPClientSession(
    client,
    name,
    undefined,
    createMockLogger(),
  );

  return { server, client: mcpClientSession };
}

// Helper to create a test MCP server with resources
async function createTestServerWithResources(
  name: string,
  resources: Resource[],
  readHandlers: Record<string, (uri: string) => Promise<ReadResourceResult>>,
): Promise<{ server: McpServer; client: MCPClientSession }> {
  const server = new McpServer(
    {
      name,
      version: "1.0.0",
    },
    {
      capabilities: {
        resources: {},
      },
    },
  );

  // Register resources
  for (const resource of resources) {
    const handler = readHandlers[resource.uri];
    if (handler) {
      server.registerResource(
        resource.name,
        resource.uri,
        {
          description: resource.description,
          mimeType: resource.mimeType,
        },
        async (uri) => handler(uri.toString()),
      );
    }
  }

  // Create linked transports
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  // Connect server
  await server.connect(serverTransport);

  // Create and connect client
  const client = new Client(
    {
      name: "test-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  await client.connect(clientTransport);

  // Wrap in MCPClientSession
  const mcpClientSession = new MCPClientSession(
    client,
    name,
    undefined,
    createMockLogger(),
  );

  return { server, client: mcpClientSession };
}

async function createTestServerWithPrompts(
  name: string,
  prompts: Array<{
    name: string;
    description?: string;
    arguments?: Array<{
      name: string;
      description?: string;
      required?: boolean;
    }>;
  }>,
  getHandlers: Record<
    string,
    (args?: Record<string, string>) => Promise<GetPromptResult>
  >,
): Promise<{ server: McpServer; client: MCPClientSession }> {
  const server = new McpServer(
    {
      name,
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
      },
    },
  );

  // Register prompts
  for (const prompt of prompts) {
    const handler = getHandlers[prompt.name];
    if (handler) {
      // Convert arguments array to Zod schema
      const argsSchema: Record<string, z.ZodType> = {};
      if (prompt.arguments) {
        for (const arg of prompt.arguments) {
          argsSchema[arg.name] = arg.required
            ? z.string().describe(arg.description || "")
            : z
                .string()
                .optional()
                .describe(arg.description || "");
        }
      }

      server.registerPrompt(
        prompt.name,
        {
          description: prompt.description,
          argsSchema:
            Object.keys(argsSchema).length > 0 ? argsSchema : undefined,
        },
        async (args) => handler(args as Record<string, string> | undefined),
      );
    }
  }

  // Create linked transports
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  // Connect server
  await server.connect(serverTransport);

  // Create and connect client
  const client = new Client(
    {
      name: "test-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  await client.connect(clientTransport);

  // Wrap in MCPClientSession
  const mcpClientSession = new MCPClientSession(
    client,
    name,
    undefined,
    createMockLogger(),
  );

  return { server, client: mcpClientSession };
}

// Helper to create a test MCP server with both tools AND resources
async function createTestServerWithToolsAndResources(
  name: string,
  tools: Array<{
    name: string;
    description: string;
    handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
  }>,
  resources: Resource[],
  readHandlers: Record<string, (uri: string) => Promise<ReadResourceResult>>,
): Promise<{ server: McpServer; client: MCPClientSession }> {
  const server = new McpServer(
    {
      name,
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // Register tools
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: z.any(),
      },
      async (args: Record<string, unknown>) => {
        return await tool.handler(args);
      },
    );
  }

  // Register resources
  for (const resource of resources) {
    const handler = readHandlers[resource.uri];
    if (handler) {
      server.registerResource(
        resource.name,
        resource.uri,
        {
          description: resource.description,
          mimeType: resource.mimeType,
        },
        async (uri) => handler(uri.toString()),
      );
    }
  }

  // Create linked transports
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  // Connect server
  await server.connect(serverTransport);

  // Create and connect client
  const client = new Client(
    {
      name: "test-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  await client.connect(clientTransport);

  // Wrap in MCPClientSession
  const mcpClientSession = new MCPClientSession(
    client,
    name,
    undefined,
    createMockLogger(),
  );

  return { server, client: mcpClientSession };
}

function assertTextContentBlock(
  content: ContentBlock | undefined,
): asserts content is TextContent {
  if (content?.type !== "text") {
    throw new Error("Expected text content block");
  }
}

describe("MCPGatewayServer - execute tool", () => {
  let gatewayServer: MCPGatewayServer;
  let luaRuntime: ILuaRuntime;
  let clientManager: IMCPClientManager;
  let logger: ILogger;
  let gateway: McpServer;
  let gatewayClient: Client;
  const cleanupFns: Array<() => Promise<void>> = [];

  beforeEach(() => {
    logger = createMockLogger();
    luaRuntime = new WasmoonRuntime(logger);
  });

  afterEach(async () => {
    // Clean up all servers and clients
    for (const cleanup of cleanupFns) {
      await cleanup();
    }
    cleanupFns.length = 0;
    if (gatewayClient) {
      await gatewayClient.close();
    }
    if (gateway) {
      await gateway.close();
    }
  });

  describe("CallToolResult passthrough", () => {
    it("should pass through CallToolResult with image content", async () => {
      const { server, client } = await createTestServer("image-server", [
        {
          name: "generate-image",
          description: "Generate an image",
          handler: async () => ({
            content: [
              { type: "text", text: "Here's your image:" },
              {
                type: "image",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                mimeType: "image/png",
              },
            ],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["image-server", client]]);
      clientManager = createMockClientManager(servers);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        result(image_server.generate_image({}):await())
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // The result should have image content preserved
      expect(result.content).toEqual([
        { type: "text", text: "Here's your image:" },
        {
          type: "image",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          mimeType: "image/png",
        },
      ]);
    });

    it("should pass through CallToolResult with audio content", async () => {
      const { server, client } = await createTestServer("audio-server", [
        {
          name: "generate-audio",
          description: "Generate audio",
          handler: async () => ({
            content: [
              { type: "text", text: "Here's your audio:" },
              {
                type: "audio",
                data: "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA",
                mimeType: "audio/mp3",
              },
            ],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["audio-server", client]]);
      clientManager = createMockClientManager(servers);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        result(audio_server.generate_audio({}):await())
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(result.content).toEqual([
        { type: "text", text: "Here's your audio:" },
        {
          type: "audio",
          data: "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA",
          mimeType: "audio/mp3",
        },
      ]);
    });

    it("should pass through CallToolResult with multiple content blocks", async () => {
      const { server, client } = await createTestServer("multi-server", [
        {
          name: "multi-content",
          description: "Return multiple content types",
          handler: async () => ({
            content: [
              { type: "text", text: "First text" },
              { type: "text", text: "Second text" },
              {
                type: "image",
                data: "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAIBAQIBAQICAgICAgICAwUDAwMDAwYEBAMFBwYHBwcGBwcICQsJCAgKCAcHCg0KCgsMDAwMBwkODw0MDgsMDAz/2wBDAQICAgMDAwYDAwYMCAcIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAz/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlbaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9/KKKKAP/2Q==",
                mimeType: "image/jpeg",
              },
            ],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["multi-server", client]]);
      clientManager = createMockClientManager(servers);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        result(multi_server.multi_content({}):await())
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(result.content).toEqual([
        { type: "text", text: "First text" },
        { type: "text", text: "Second text" },
        {
          type: "image",
          data: "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAIBAQIBAQICAgICAgICAwUDAwMDAwYEBAMFBwYHBwcGBwcICQsJCAgKCAcHCg0KCgsMDAwMBwkODw0MDgsMDAz/2wBDAQICAgMDAwYDAwYMCAcIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAz/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlbaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9/KKKKAP/2Q==",
          mimeType: "image/jpeg",
        },
      ]);
    });

    it("should pass through CallToolResult with isError flag", async () => {
      const { server, client } = await createTestServer("error-server", [
        {
          name: "failing-tool",
          description: "A tool that returns an error",
          handler: async () => ({
            content: [{ type: "text", text: "Tool failed: invalid input" }],
            isError: true,
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["error-server", client]]);
      clientManager = createMockClientManager(servers);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        result(error_server.failing_tool({}):await())
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(result.content).toEqual([
        { type: "text", text: "Tool failed: invalid input" },
      ]);
      expect(result.isError).toBe(true);
    });
  });

  describe("Object to structuredContent conversion", () => {
    it("should convert object result to structuredContent", async () => {
      clientManager = createMockClientManager(new Map());
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        result({
          name = "claude",
          level = 9000,
          items = { "sword", "shield" }
        })
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // The object should be converted to structuredContent by the gateway
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      const content = (result.content as Array<ContentBlock>)[0];
      expect(content).toHaveProperty("type", "text");
      expect(result).toHaveProperty("structuredContent");
      expect(result.structuredContent).toEqual({
        name: "claude",
        level: 9000,
        items: ["sword", "shield"],
      });
    });

    it("should convert nested object to structuredContent", async () => {
      clientManager = createMockClientManager(new Map());
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        result({
          user = {
            name = "alice",
            stats = {
              hp = 100,
              mp = 50
            }
          }
        })
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      const content = (result.content as Array<ContentBlock>)[0];
      expect(content).toHaveProperty("type", "text");
      expect(result).toHaveProperty("structuredContent");
      expect(result.structuredContent).toEqual({
        user: {
          name: "alice",
          stats: {
            hp: 100,
            mp: 50,
          },
        },
      });
    });

    it("should handle empty object", async () => {
      clientManager = createMockClientManager(new Map());
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        result({})
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      const content = (result.content as Array<ContentBlock>)[0];
      expect(content).toHaveProperty("type", "text");
      expect(result).toHaveProperty("structuredContent");
      expect(result.structuredContent).toEqual({});
    });
  });

  describe("Primitive value handling", () => {
    it("should handle string results", async () => {
      clientManager = createMockClientManager(new Map());
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        result("hello world")
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      const content = (result.content as Array<ContentBlock>)[0];
      assertTextContentBlock(content);
      expect(content.text).toContain("hello world");
    });

    it("should handle number results", async () => {
      clientManager = createMockClientManager(new Map());
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        result(42)
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      const content = (result.content as Array<ContentBlock>)[0];
      assertTextContentBlock(content);
      expect(content.text).toContain("42");
    });

    it("should handle boolean results", async () => {
      clientManager = createMockClientManager(new Map());
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        result(true)
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      const content = (result.content as Array<ContentBlock>)[0];
      assertTextContentBlock(content);
      expect(content.text).toContain("true");
    });

    it("should handle nil/undefined results", async () => {
      clientManager = createMockClientManager(new Map());
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        -- No result set
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      const content = (result.content as Array<ContentBlock>)[0];
      assertTextContentBlock(content);
      expect(content.text).toContain(
        "Script executed successfully. No result returned.",
      );
    });
  });

  describe("Integration with MCP tool results", () => {
    it("should preserve rich content when returning tool results directly", async () => {
      const { server, client } = await createTestServer("rich-server", [
        {
          name: "get-report",
          description: "Get a report with charts",
          handler: async () => ({
            content: [
              { type: "text", text: "Sales Report Q4 2024" },
              {
                type: "image",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                mimeType: "image/png",
              },
              { type: "text", text: "Revenue: $1M" },
            ],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["rich-server", client]]);
      clientManager = createMockClientManager(servers);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        -- Return the tool result directly
        result(rich_server.get_report({}):await())
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // Should preserve all content blocks
      expect(result.content).toEqual([
        { type: "text", text: "Sales Report Q4 2024" },
        {
          type: "image",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          mimeType: "image/png",
        },
        { type: "text", text: "Revenue: $1M" },
      ]);
    });

    it("should use structuredContent when processing tool results into objects", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "get-data",
          description: "Get data",
          handler: async () => ({
            content: [{ type: "text", text: '{"value": 123}' }],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["api", client]]);
      clientManager = createMockClientManager(servers);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        -- Process the tool result and return a custom object
        local response = api.get_data({}):await()
        result({
          raw = response,
          processed = true,
          timestamp = 1234567890
        })
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // Should be an object wrapped in structuredContent
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      const content = (result.content as Array<ContentBlock>)[0];
      expect(content).toHaveProperty("type", "text");
      expect(result).toHaveProperty("structuredContent");
      expect(typeof result.structuredContent).toBe("object");
      expect(result.structuredContent).toHaveProperty("raw");
      expect(result.structuredContent).toHaveProperty("processed", true);
      expect(result.structuredContent).toHaveProperty("timestamp", 1234567890);
    });
  });

  describe("Error handling in execute tool", () => {
    it("should handle Lua script errors gracefully", async () => {
      clientManager = createMockClientManager(new Map());
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        error("intentional error")
      `;

      // Execute the script through the gateway server - should return error result
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      expect(result.isError).toBe(true);
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      const content = (result.content as Array<ContentBlock>)[0];
      assertTextContentBlock(content);
      expect(content.text).toContain("Script execution failed");
    });

    it("should handle invalid CallToolResult objects", async () => {
      clientManager = createMockClientManager(new Map());
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const script = `
        -- Return something that looks like CallToolResult but isn't valid
        result({
          content = "not an array"
        })
      `;

      // Execute the script through the gateway server
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // Should fall back to structuredContent since it's not a valid CallToolResult
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      const content = (result.content as Array<ContentBlock>)[0];
      expect(content).toHaveProperty("type", "text");
      expect(result).toHaveProperty("structuredContent");
      expect(result.structuredContent).toEqual({
        content: "not an array",
      });
    });
  });
});

describe("MCPGatewayServer - Resource Aggregation", () => {
  let gatewayServer: MCPGatewayServer;
  let luaRuntime: ILuaRuntime;
  let logger: ILogger;
  let gateway: McpServer;
  let gatewayClient: Client;
  const cleanupFns: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    logger = createMockLogger();
    luaRuntime = new WasmoonRuntime(logger);
  });

  afterEach(async () => {
    // Clean up all servers and clients
    for (const cleanup of cleanupFns) {
      await cleanup();
    }
    cleanupFns.length = 0;
    if (gatewayClient) {
      await gatewayClient.close();
    }
    if (gateway) {
      await gateway.close();
    }
  });

  describe("listResources - aggregation from multiple servers", () => {
    it("should aggregate resources from multiple MCP servers", async () => {
      // Create two test servers with different resources
      const { server: server1, client: client1 } =
        await createTestServerWithResources(
          "docs-server",
          [
            {
              uri: "file:///docs/README.md",
              name: "README",
              description: "Project README",
              mimeType: "text/markdown",
            },
            {
              uri: "file:///docs/API.md",
              name: "API Docs",
              description: "API documentation",
              mimeType: "text/markdown",
            },
          ],
          {
            "file:///docs/README.md": async () => ({
              contents: [
                {
                  uri: "file:///docs/README.md",
                  mimeType: "text/markdown",
                  text: "# README\nProject documentation",
                },
              ],
            }),
            "file:///docs/API.md": async () => ({
              contents: [
                {
                  uri: "file:///docs/API.md",
                  mimeType: "text/markdown",
                  text: "# API\nAPI endpoints",
                },
              ],
            }),
          },
        );

      const { server: server2, client: client2 } =
        await createTestServerWithResources(
          "config-server",
          [
            {
              uri: "file:///config/settings.json",
              name: "Settings",
              description: "Configuration settings",
              mimeType: "application/json",
            },
          ],
          {
            "file:///config/settings.json": async () => ({
              contents: [
                {
                  uri: "file:///config/settings.json",
                  mimeType: "application/json",
                  text: '{"debug": true}',
                },
              ],
            }),
          },
        );

      cleanupFns.push(
        async () => {
          await client1.close();
          await server1.close();
        },
        async () => {
          await client2.close();
          await server2.close();
        },
      );

      // Create gateway with both clients
      const clients = new Map([
        ["docs-server", client1],
        ["config-server", client2],
      ]);
      const clientManager = createMockClientManager(clients);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      // Connect to gateway
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      // List resources through the gateway
      const result = await gatewayClient.listResources();

      // Should have 3 resources total, all namespaced
      expect(result.resources).toHaveLength(3);

      // Check that URIs are namespaced
      const uris = result.resources.map((r) => r.uri);
      expect(uris).toContain("mcp://docs-server/file:///docs/README.md");
      expect(uris).toContain("mcp://docs-server/file:///docs/API.md");
      expect(uris).toContain(
        "mcp://config-server/file:///config/settings.json",
      );

      // Check that original metadata is preserved
      const readmeResource = result.resources.find((r) =>
        r.uri.includes("README"),
      );
      expect(readmeResource?.name).toBe("README");
      expect(readmeResource?.description).toBe("Project README");
      expect(readmeResource?.mimeType).toBe("text/markdown");
    });

    it("should return empty array when no clients have resources", async () => {
      const clients = new Map();
      const clientManager = createMockClientManager(clients);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const result = await gatewayClient.listResources();

      expect(result.resources).toEqual([]);
    });

    it("should cache aggregated resources", async () => {
      const { server: server1, client: client1 } =
        await createTestServerWithResources(
          "test-server",
          [
            {
              uri: "file:///test.txt",
              name: "Test",
              description: "Test resource",
              mimeType: "text/plain",
            },
          ],
          {
            "file:///test.txt": async () => ({
              contents: [
                {
                  uri: "file:///test.txt",
                  mimeType: "text/plain",
                  text: "test content",
                },
              ],
            }),
          },
        );

      cleanupFns.push(async () => {
        await client1.close();
        await server1.close();
      });

      const clients = new Map([["test-server", client1]]);
      const clientManager = createMockClientManager(clients);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      // First call
      const result1 = await gatewayClient.listResources();
      expect(result1.resources).toHaveLength(1);

      // Second call should use cache
      const result2 = await gatewayClient.listResources();
      expect(result2.resources).toHaveLength(1);

      // Results should be identical
      expect(result1.resources[0]).toEqual(result2.resources[0]);
    });
  });

  describe("readResource - routing to correct server", () => {
    it("should read resource from correct server based on namespaced URI", async () => {
      const { server, client } = await createTestServerWithResources(
        "docs-server",
        [
          {
            uri: "file:///docs/README.md",
            name: "README",
            description: "Project README",
            mimeType: "text/markdown",
          },
        ],
        {
          "file:///docs/README.md": async () => ({
            contents: [
              {
                uri: "file:///docs/README.md",
                mimeType: "text/markdown",
                text: "# Project Documentation\n\nWelcome!",
              },
            ],
          }),
        },
      );

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const clients = new Map([["docs-server", client]]);
      const clientManager = createMockClientManager(clients);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      // Read resource using namespaced URI
      const result = await gatewayClient.readResource({
        uri: "mcp://docs-server/file:///docs/README.md",
      });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toMatchObject({
        uri: "file:///docs/README.md",
        mimeType: "text/markdown",
        text: "# Project Documentation\n\nWelcome!",
      });
    });

    it("should throw error for invalid URI format", async () => {
      const clients = new Map();
      const clientManager = createMockClientManager(clients);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      // Try to read with invalid URI format
      await expect(
        gatewayClient.readResource({ uri: "not-a-valid-uri" }),
      ).rejects.toThrow();
    });

    it("should throw error for non-existent server", async () => {
      const clients = new Map();
      const clientManager = createMockClientManager(clients);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      // Try to read from non-existent server
      await expect(
        gatewayClient.readResource({
          uri: "mcp://non-existent-server/file:///test.txt",
        }),
      ).rejects.toThrow(/not found/);
    });
  });

  describe("Tool results with resource links", () => {
    it("should handle tool that returns resource link and subsequent resource read", async () => {
      // Create a server with both a tool AND a resource
      const { server, client } = await createTestServerWithToolsAndResources(
        "data-server",
        [
          {
            name: "get-report-link",
            description: "Get a link to the report resource",
            handler: async () => ({
              content: [
                {
                  type: "text",
                  text: "Here is the report resource:",
                },
                {
                  type: "resource_link",
                  name: "Report",
                  uri: "file:///data/report.json",
                  description: "Data report",
                  mimeType: "application/json",
                },
              ],
            }),
          },
        ],
        [
          {
            uri: "file:///data/report.json",
            name: "Report",
            description: "Data report",
            mimeType: "application/json",
          },
        ],
        {
          "file:///data/report.json": async () => ({
            contents: [
              {
                uri: "file:///data/report.json",
                mimeType: "application/json",
                text: '{"sales": 1000, "users": 50}',
              },
            ],
          }),
        },
      );

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const clients = new Map([["data-server", client]]);
      const clientManager = createMockClientManager(clients);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      // Step 1: Call the tool to get the resource link
      const script = `
        result(data_server.get_report_link({}):await())
      `;

      const toolResult = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // Verify the tool result contains the resource reference
      expect(Array.isArray(toolResult.content)).toBe(true);
      const content = toolResult.content as Array<ContentBlock>;
      expect(content.length).toBeGreaterThan(0);

      // Find the resource_link content block
      const resourceLinkBlock = content.find(
        (block: unknown) =>
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "resource_link",
      );
      expect(resourceLinkBlock).toBeDefined();

      // Extract the URI from the resource_link block (flat structure!)
      let resourceUri: string | undefined;
      if (
        resourceLinkBlock &&
        typeof resourceLinkBlock === "object" &&
        "uri" in resourceLinkBlock
      ) {
        resourceUri = resourceLinkBlock.uri as string;
      }

      expect(resourceUri).toBeDefined();

      // Step 2: Verify the URI is automatically namespaced!
      // The gateway should have automatically rewritten the URI from
      // "file:///data/report.json" to "mcp://data-server/file:///data/report.json"
      expect(resourceUri).toBe("mcp://data-server/file:///data/report.json");

      // Step 3: Now we can directly use this URI to read the resource!
      // No manual namespacing needed - the gateway did it for us!
      const readResult = await gatewayClient.readResource({
        uri: resourceUri!,
      });

      expect(readResult.contents).toHaveLength(1);
      expect(readResult.contents[0]).toMatchObject({
        uri: "file:///data/report.json",
        mimeType: "application/json",
        text: '{"sales": 1000, "users": 50}',
      });
    });
  });

  describe("URI namespacing", () => {
    it("should correctly namespace URIs with special characters", async () => {
      const { server, client } = await createTestServerWithResources(
        "special-server",
        [
          {
            uri: "https://example.com/path?query=value&other=123",
            name: "Web Resource",
            description: "Resource with query params",
            mimeType: "text/html",
          },
        ],
        {
          "https://example.com/path?query=value&other=123": async () => ({
            contents: [
              {
                uri: "https://example.com/path?query=value&other=123",
                mimeType: "text/html",
                text: "<html>content</html>",
              },
            ],
          }),
        },
      );

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const clients = new Map([["special-server", client]]);
      const clientManager = createMockClientManager(clients);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      const result = await gatewayClient.listResources();

      expect(result.resources[0]?.uri).toBe(
        "mcp://special-server/https://example.com/path?query=value&other=123",
      );
    });

    it("should handle resources from servers with similar names", async () => {
      const { server: server1, client: client1 } =
        await createTestServerWithResources(
          "docs",
          [
            {
              uri: "file:///README.md",
              name: "Docs README",
              mimeType: "text/markdown",
            },
          ],
          {
            "file:///README.md": async () => ({
              contents: [
                {
                  uri: "file:///README.md",
                  mimeType: "text/markdown",
                  text: "Docs content",
                },
              ],
            }),
          },
        );

      const { server: server2, client: client2 } =
        await createTestServerWithResources(
          "docs-v2",
          [
            {
              uri: "file:///README.md",
              name: "Docs v2 README",
              mimeType: "text/markdown",
            },
          ],
          {
            "file:///README.md": async () => ({
              contents: [
                {
                  uri: "file:///README.md",
                  mimeType: "text/markdown",
                  text: "Docs v2 content",
                },
              ],
            }),
          },
        );

      cleanupFns.push(
        async () => {
          await client1.close();
          await server1.close();
        },
        async () => {
          await client2.close();
          await server2.close();
        },
      );

      const clients = new Map([
        ["docs", client1],
        ["docs-v2", client2],
      ]);
      const clientManager = createMockClientManager(clients);
      gatewayServer = new MCPGatewayServer(
        createToolRegistry(luaRuntime, clientManager, logger),
        clientManager,
        logger,
        new ResourceAggregationService(clientManager, logger),
        new PromptAggregationService(clientManager, logger),
      );
      gateway = gatewayServer.getServer();

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await gateway.connect(serverTransport);

      gatewayClient = new Client(
        { name: "test-gateway-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await gatewayClient.connect(clientTransport);

      // Both resources should be listed with different namespaces
      const result = await gatewayClient.listResources();

      expect(result.resources).toHaveLength(2);
      const uris = result.resources.map((r) => r.uri);
      expect(uris).toContain("mcp://docs/file:///README.md");
      expect(uris).toContain("mcp://docs-v2/file:///README.md");

      // Read from each server to verify routing works
      const result1 = await gatewayClient.readResource({
        uri: "mcp://docs/file:///README.md",
      });
      const content1 = result1.contents[0];
      expect(content1 && "text" in content1 ? content1.text : undefined).toBe(
        "Docs content",
      );

      const result2 = await gatewayClient.readResource({
        uri: "mcp://docs-v2/file:///README.md",
      });
      const content2 = result2.contents[0];
      expect(content2 && "text" in content2 ? content2.text : undefined).toBe(
        "Docs v2 content",
      );
    });
  });

  describe("Prompt Aggregation", () => {
    let gatewayServer: MCPGatewayServer;
    let luaRuntime: ILuaRuntime;
    let logger: ILogger;
    let gateway: McpServer;
    let gatewayClient: Client;
    const cleanupFns: Array<() => Promise<void>> = [];

    beforeEach(async () => {
      logger = createMockLogger();
      luaRuntime = new WasmoonRuntime(logger);
    });

    afterEach(async () => {
      // Clean up all servers and clients
      for (const cleanup of cleanupFns) {
        await cleanup();
      }
      cleanupFns.length = 0;
      if (gatewayClient) {
        await gatewayClient.close();
      }
      if (gateway) {
        await gateway.close();
      }
    });

    describe("listPrompts - aggregation from multiple servers", () => {
      it("should aggregate prompts from multiple MCP servers", async () => {
        // Create two test servers with different prompts
        const { server: server1, client: client1 } =
          await createTestServerWithPrompts(
            "code-server",
            [
              {
                name: "code-review",
                description: "Review code for best practices",
                arguments: [
                  {
                    name: "language",
                    description: "Programming language",
                    required: true,
                  },
                ],
              },
              {
                name: "generate-tests",
                description: "Generate unit tests",
              },
            ],
            {
              "code-review": async (args) => ({
                messages: [
                  {
                    role: "user",
                    content: {
                      type: "text",
                      text: `Review this ${args?.language || "code"}`,
                    },
                  },
                ],
              }),
              "generate-tests": async () => ({
                messages: [
                  {
                    role: "user",
                    content: {
                      type: "text",
                      text: "Generate unit tests for this code",
                    },
                  },
                ],
              }),
            },
          );

        const { server: server2, client: client2 } =
          await createTestServerWithPrompts(
            "docs-server",
            [
              {
                name: "explain-concept",
                description: "Explain a technical concept",
                arguments: [
                  {
                    name: "concept",
                    description: "The concept to explain",
                    required: true,
                  },
                ],
              },
            ],
            {
              "explain-concept": async (args) => ({
                messages: [
                  {
                    role: "user",
                    content: {
                      type: "text",
                      text: `Explain ${args?.concept || "the concept"}`,
                    },
                  },
                ],
              }),
            },
          );

        cleanupFns.push(
          async () => {
            await client1.close();
            await server1.close();
          },
          async () => {
            await client2.close();
            await server2.close();
          },
        );

        // Create gateway with both clients
        const clients = new Map<string, MCPClientSession>([
          ["code-server", client1],
          ["docs-server", client2],
        ]);

        const clientManager = createMockClientManager(clients);
        gatewayServer = new MCPGatewayServer(
          createToolRegistry(luaRuntime, clientManager, logger),
          clientManager,
          logger,
          new ResourceAggregationService(clientManager, logger),
          new PromptAggregationService(clientManager, logger),
        );
        gateway = gatewayServer.getServer();

        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        await gateway.connect(serverTransport);

        gatewayClient = new Client(
          { name: "test-gateway-client", version: "1.0.0" },
          { capabilities: {} },
        );
        await gatewayClient.connect(clientTransport);

        // List all prompts
        const result = await gatewayClient.listPrompts();

        // Should have 3 prompts total (2 from code-server, 1 from docs-server)
        expect(result.prompts).toHaveLength(3);

        // Check that names are properly namespaced
        const promptNames = result.prompts.map((p) => p.name);
        expect(promptNames).toContain("code-server/code-review");
        expect(promptNames).toContain("code-server/generate-tests");
        expect(promptNames).toContain("docs-server/explain-concept");

        // Check that descriptions are preserved
        const codeReview = result.prompts.find(
          (p) => p.name === "code-server/code-review",
        );
        expect(codeReview?.description).toBe("Review code for best practices");

        // Check that arguments are preserved
        expect(codeReview?.arguments).toHaveLength(1);
        expect(codeReview?.arguments?.[0]?.name).toBe("language");
      });

      it("should handle empty prompt lists", async () => {
        const { server, client } = await createTestServerWithPrompts(
          "empty-server",
          [],
          {},
        );

        cleanupFns.push(async () => {
          await client.close();
          await server.close();
        });

        const clients = new Map<string, MCPClientSession>([
          ["empty-server", client],
        ]);

        const clientManager = createMockClientManager(clients);
        gatewayServer = new MCPGatewayServer(
          createToolRegistry(luaRuntime, clientManager, logger),
          clientManager,
          logger,
          new ResourceAggregationService(clientManager, logger),
          new PromptAggregationService(clientManager, logger),
        );
        gateway = gatewayServer.getServer();

        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        await gateway.connect(serverTransport);

        gatewayClient = new Client(
          { name: "test-gateway-client", version: "1.0.0" },
          { capabilities: {} },
        );
        await gatewayClient.connect(clientTransport);

        const result = await gatewayClient.listPrompts();

        expect(result.prompts).toHaveLength(0);
      });

      it("should handle prompts from servers with similar names", async () => {
        const { server: server1, client: client1 } =
          await createTestServerWithPrompts(
            "docs",
            [
              {
                name: "help",
                description: "Docs help",
              },
            ],
            {
              help: async () => ({
                messages: [
                  {
                    role: "user",
                    content: {
                      type: "text",
                      text: "Docs help message",
                    },
                  },
                ],
              }),
            },
          );

        const { server: server2, client: client2 } =
          await createTestServerWithPrompts(
            "docs-v2",
            [
              {
                name: "help",
                description: "Docs v2 help",
              },
            ],
            {
              help: async () => ({
                messages: [
                  {
                    role: "user",
                    content: {
                      type: "text",
                      text: "Docs v2 help message",
                    },
                  },
                ],
              }),
            },
          );

        cleanupFns.push(
          async () => {
            await client1.close();
            await server1.close();
          },
          async () => {
            await client2.close();
            await server2.close();
          },
        );

        const clients = new Map<string, MCPClientSession>([
          ["docs", client1],
          ["docs-v2", client2],
        ]);

        const clientManager = createMockClientManager(clients);
        gatewayServer = new MCPGatewayServer(
          createToolRegistry(luaRuntime, clientManager, logger),
          clientManager,
          logger,
          new ResourceAggregationService(clientManager, logger),
          new PromptAggregationService(clientManager, logger),
        );
        gateway = gatewayServer.getServer();

        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        await gateway.connect(serverTransport);

        gatewayClient = new Client(
          { name: "test-gateway-client", version: "1.0.0" },
          { capabilities: {} },
        );
        await gatewayClient.connect(clientTransport);

        // Both prompts should be listed with different namespaces
        const result = await gatewayClient.listPrompts();

        expect(result.prompts).toHaveLength(2);
        const names = result.prompts.map((p) => p.name);
        expect(names).toContain("docs/help");
        expect(names).toContain("docs-v2/help");
      });
    });

    describe("getPrompt - routing to correct server", () => {
      it("should route getPrompt to the correct server by name", async () => {
        const { server: server1, client: client1 } =
          await createTestServerWithPrompts(
            "code-server",
            [
              {
                name: "review",
                description: "Code review",
              },
            ],
            {
              review: async () => ({
                messages: [
                  {
                    role: "user",
                    content: {
                      type: "text",
                      text: "Review this code please",
                    },
                  },
                ],
                description: "Code review prompt",
              }),
            },
          );

        const { server: server2, client: client2 } =
          await createTestServerWithPrompts(
            "docs-server",
            [
              {
                name: "explain",
                description: "Explain concept",
              },
            ],
            {
              explain: async () => ({
                messages: [
                  {
                    role: "user",
                    content: {
                      type: "text",
                      text: "Explain this concept",
                    },
                  },
                ],
                description: "Explanation prompt",
              }),
            },
          );

        cleanupFns.push(
          async () => {
            await client1.close();
            await server1.close();
          },
          async () => {
            await client2.close();
            await server2.close();
          },
        );

        const clients = new Map<string, MCPClientSession>([
          ["code-server", client1],
          ["docs-server", client2],
        ]);

        const clientManager = createMockClientManager(clients);
        gatewayServer = new MCPGatewayServer(
          createToolRegistry(luaRuntime, clientManager, logger),
          clientManager,
          logger,
          new ResourceAggregationService(clientManager, logger),
          new PromptAggregationService(clientManager, logger),
        );
        gateway = gatewayServer.getServer();

        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        await gateway.connect(serverTransport);

        gatewayClient = new Client(
          { name: "test-gateway-client", version: "1.0.0" },
          { capabilities: {} },
        );
        await gatewayClient.connect(clientTransport);

        // Get prompt from code-server
        const result1 = await gatewayClient.getPrompt({
          name: "code-server/review",
        });

        expect(result1.messages).toHaveLength(1);
        const message1 = result1.messages[0];
        expect(message1?.role).toBe("user");
        expect(
          message1?.content && "text" in message1.content
            ? message1.content.text
            : undefined,
        ).toBe("Review this code please");
        expect(result1.description).toBe("Code review prompt");

        // Get prompt from docs-server
        const result2 = await gatewayClient.getPrompt({
          name: "docs-server/explain",
        });

        expect(result2.messages).toHaveLength(1);
        const message2 = result2.messages[0];
        expect(message2?.role).toBe("user");
        expect(
          message2?.content && "text" in message2.content
            ? message2.content.text
            : undefined,
        ).toBe("Explain this concept");
        expect(result2.description).toBe("Explanation prompt");
      });

      it("should pass arguments through to the underlying server", async () => {
        const { server, client } = await createTestServerWithPrompts(
          "code-server",
          [
            {
              name: "review",
              description: "Code review",
              arguments: [
                {
                  name: "language",
                  description: "Programming language",
                  required: true,
                },
                { name: "style", description: "Code style", required: false },
              ],
            },
          ],
          {
            review: async (args) => ({
              messages: [
                {
                  role: "user",
                  content: {
                    type: "text",
                    text: `Review this ${args?.language || "code"} with ${args?.style || "default"} style`,
                  },
                },
              ],
            }),
          },
        );

        cleanupFns.push(async () => {
          await client.close();
          await server.close();
        });

        const clients = new Map<string, MCPClientSession>([
          ["code-server", client],
        ]);

        const clientManager = createMockClientManager(clients);
        gatewayServer = new MCPGatewayServer(
          createToolRegistry(luaRuntime, clientManager, logger),
          clientManager,
          logger,
          new ResourceAggregationService(clientManager, logger),
          new PromptAggregationService(clientManager, logger),
        );
        gateway = gatewayServer.getServer();

        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        await gateway.connect(serverTransport);

        gatewayClient = new Client(
          { name: "test-gateway-client", version: "1.0.0" },
          { capabilities: {} },
        );
        await gatewayClient.connect(clientTransport);

        // Get prompt with arguments
        const result = await gatewayClient.getPrompt({
          name: "code-server/review",
          arguments: {
            language: "TypeScript",
            style: "functional",
          },
        });

        expect(result.messages).toHaveLength(1);
        const message = result.messages[0];
        expect(
          message?.content && "text" in message.content
            ? message.content.text
            : undefined,
        ).toBe("Review this TypeScript with functional style");
      });

      it("should return error for invalid prompt name format", async () => {
        const { server, client } = await createTestServerWithPrompts(
          "test-server",
          [],
          {},
        );

        cleanupFns.push(async () => {
          await client.close();
          await server.close();
        });

        const clients = new Map<string, MCPClientSession>([
          ["test-server", client],
        ]);

        const clientManager = createMockClientManager(clients);
        gatewayServer = new MCPGatewayServer(
          createToolRegistry(luaRuntime, clientManager, logger),
          clientManager,
          logger,
          new ResourceAggregationService(clientManager, logger),
          new PromptAggregationService(clientManager, logger),
        );
        gateway = gatewayServer.getServer();

        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        await gateway.connect(serverTransport);

        gatewayClient = new Client(
          { name: "test-gateway-client", version: "1.0.0" },
          { capabilities: {} },
        );
        await gatewayClient.connect(clientTransport);

        // Try to get prompt with invalid name (no slash separator)
        await expect(
          gatewayClient.getPrompt({ name: "invalid-name-format" }),
        ).rejects.toThrow();
      });

      it("should return error for non-existent server", async () => {
        const { server, client } = await createTestServerWithPrompts(
          "existing-server",
          [
            {
              name: "prompt1",
              description: "Test prompt",
            },
          ],
          {
            prompt1: async () => ({
              messages: [
                {
                  role: "user",
                  content: {
                    type: "text",
                    text: "Test",
                  },
                },
              ],
            }),
          },
        );

        cleanupFns.push(async () => {
          await client.close();
          await server.close();
        });

        const clients = new Map<string, MCPClientSession>([
          ["existing-server", client],
        ]);

        const clientManager = createMockClientManager(clients);
        gatewayServer = new MCPGatewayServer(
          createToolRegistry(luaRuntime, clientManager, logger),
          clientManager,
          logger,
          new ResourceAggregationService(clientManager, logger),
          new PromptAggregationService(clientManager, logger),
        );
        gateway = gatewayServer.getServer();

        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        await gateway.connect(serverTransport);

        gatewayClient = new Client(
          { name: "test-gateway-client", version: "1.0.0" },
          { capabilities: {} },
        );
        await gatewayClient.connect(clientTransport);

        // Try to get prompt from non-existent server
        await expect(
          gatewayClient.getPrompt({ name: "non-existent-server/prompt1" }),
        ).rejects.toThrow();
      });
    });
  });
});
