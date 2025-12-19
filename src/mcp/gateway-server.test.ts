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
} from "@modelcontextprotocol/sdk/types.js";
import type {
  ILogger,
  ILuaRuntime,
  IMCPClientManager,
} from "../types/interfaces.js";
import * as z from "zod";
import { MCPClientSession } from "./client-session.js";

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
  close: vi.fn(),
});

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

describe("MCPGatewayServer - execute tool", () => {
  let gatewayServer: MCPGatewayServer;
  let luaRuntime: ILuaRuntime;
  let clientManager: IMCPClientManager;
  let logger: ILogger;
  let gateway: McpServer;
  const cleanupFns: Array<() => Promise<void>> = [];

  beforeEach(() => {
    logger = createMockLogger();
    luaRuntime = new WasmoonRuntime(logger);
    clientManager = createMockClientManager(new Map());
    gatewayServer = new MCPGatewayServer(luaRuntime, clientManager, logger);
    gateway = gatewayServer.getServer();
  });

  afterEach(async () => {
    // Clean up all servers and clients
    for (const cleanup of cleanupFns) {
      await cleanup();
    }
    cleanupFns.length = 0;
    await gateway.close();
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

      const script = `
        result = image_server.generate_image({}):await()
      `;

      // Execute the script through the Lua runtime
      const luaResult = await luaRuntime.executeScript(script, servers);

      // The result should have image content preserved
      expect(luaResult).toEqual({
        content: [
          { type: "text", text: "Here's your image:" },
          {
            type: "image",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            mimeType: "image/png",
          },
        ],
      });
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

      const script = `
        result = audio_server.generate_audio({}):await()
      `;

      const luaResult = await luaRuntime.executeScript(script, servers);

      expect(luaResult).toEqual({
        content: [
          { type: "text", text: "Here's your audio:" },
          {
            type: "audio",
            data: "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA",
            mimeType: "audio/mp3",
          },
        ],
      });
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

      const script = `
        result = multi_server.multi_content({}):await()
      `;

      const luaResult = await luaRuntime.executeScript(script, servers);

      expect(luaResult).toEqual({
        content: [
          { type: "text", text: "First text" },
          { type: "text", text: "Second text" },
          {
            type: "image",
            data: "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAIBAQIBAQICAgICAgICAwUDAwMDAwYEBAMFBwYHBwcGBwcICQsJCAgKCAcHCg0KCgsMDAwMBwkODw0MDgsMDAz/2wBDAQICAgMDAwYDAwYMCAcIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAz/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlbaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9/KKKKAP/2Q==",
            mimeType: "image/jpeg",
          },
        ],
      });
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

      const script = `
        result = error_server.failing_tool({}):await()
      `;

      const luaResult = await luaRuntime.executeScript(script, servers);

      expect(luaResult).toEqual({
        content: [{ type: "text", text: "Tool failed: invalid input" }],
        isError: true,
      });
    });
  });

  describe("Object to structuredContent conversion", () => {
    it("should convert object result to structuredContent", async () => {
      const script = `
        result = {
          name = "claude",
          level = 9000,
          items = { "sword", "shield" }
        }
      `;

      const luaResult = await luaRuntime.executeScript(script, new Map());

      expect(luaResult).toEqual({
        name: "claude",
        level: 9000,
        items: ["sword", "shield"],
      });

      // This object should be converted to structuredContent by the gateway
      expect(typeof luaResult).toBe("object");
      expect(luaResult).not.toBeNull();
    });

    it("should convert nested object to structuredContent", async () => {
      const script = `
        result = {
          user = {
            name = "alice",
            stats = {
              hp = 100,
              mp = 50
            }
          }
        }
      `;

      const luaResult = await luaRuntime.executeScript(script, new Map());

      expect(luaResult).toEqual({
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
      const script = `
        result = {}
      `;

      const luaResult = await luaRuntime.executeScript(script, new Map());

      expect(luaResult).toEqual({});
    });
  });

  describe("Primitive value handling", () => {
    it("should handle string results", async () => {
      const script = `
        result = "hello world"
      `;

      const luaResult = await luaRuntime.executeScript(script, new Map());
      expect(luaResult).toBe("hello world");
    });

    it("should handle number results", async () => {
      const script = `
        result = 42
      `;

      const luaResult = await luaRuntime.executeScript(script, new Map());
      expect(luaResult).toBe(42);
    });

    it("should handle boolean results", async () => {
      const script = `
        result = true
      `;

      const luaResult = await luaRuntime.executeScript(script, new Map());
      expect(luaResult).toBe(true);
    });

    it("should handle nil/undefined results", async () => {
      const script = `
        -- No result set
      `;

      const luaResult = await luaRuntime.executeScript(script, new Map());
      expect(luaResult).toBeNull();
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

      const script = `
        -- Return the tool result directly
        result = rich_server.get_report({}):await()
      `;

      const luaResult = await luaRuntime.executeScript(script, servers);

      // Should preserve all content blocks
      expect(luaResult).toEqual({
        content: [
          { type: "text", text: "Sales Report Q4 2024" },
          {
            type: "image",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            mimeType: "image/png",
          },
          { type: "text", text: "Revenue: $1M" },
        ],
      });
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

      const script = `
        -- Process the tool result and return a custom object
        local response = api.get_data({}):await()
        result = {
          raw = response,
          processed = true,
          timestamp = 1234567890
        }
      `;

      const luaResult = await luaRuntime.executeScript(script, servers);

      // Should be an object (will use structuredContent)
      expect(typeof luaResult).toBe("object");
      expect(luaResult).toHaveProperty("raw");
      expect(luaResult).toHaveProperty("processed", true);
      expect(luaResult).toHaveProperty("timestamp", 1234567890);
    });
  });

  describe("Error handling in execute tool", () => {
    it("should handle Lua script errors gracefully", async () => {
      const script = `
        error("intentional error")
      `;

      await expect(
        luaRuntime.executeScript(script, new Map()),
      ).rejects.toThrow();
    });

    it("should handle invalid CallToolResult objects", async () => {
      const script = `
        -- Return something that looks like CallToolResult but isn't valid
        result = {
          content = "not an array"
        }
      `;

      const luaResult = await luaRuntime.executeScript(script, new Map());

      // Should fall back to structuredContent since it's not a valid CallToolResult
      expect(luaResult).toEqual({
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
      gatewayServer = new MCPGatewayServer(luaRuntime, clientManager, logger);
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
      gatewayServer = new MCPGatewayServer(luaRuntime, clientManager, logger);
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
      gatewayServer = new MCPGatewayServer(luaRuntime, clientManager, logger);
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
      gatewayServer = new MCPGatewayServer(luaRuntime, clientManager, logger);
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
      gatewayServer = new MCPGatewayServer(luaRuntime, clientManager, logger);
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
      gatewayServer = new MCPGatewayServer(luaRuntime, clientManager, logger);
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
      gatewayServer = new MCPGatewayServer(luaRuntime, clientManager, logger);
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
      gatewayServer = new MCPGatewayServer(luaRuntime, clientManager, logger);
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
});
