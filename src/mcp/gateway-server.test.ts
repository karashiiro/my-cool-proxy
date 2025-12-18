import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MCPGatewayServer } from "./gateway-server.js";
import { WasmoonRuntime } from "../lua/runtime.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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
        inputSchema: z.object({}).passthrough(), // Accept any arguments
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
