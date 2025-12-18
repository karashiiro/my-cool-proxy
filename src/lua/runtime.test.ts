import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WasmoonRuntime } from "./runtime.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ILogger } from "../types/interfaces.js";
import * as z from "zod";
import { MCPClientSession } from "../mcp/client-session.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Mock logger
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
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
        const result = await tool.handler(args);
        return result;
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

describe("WasmoonRuntime", () => {
  let runtime: WasmoonRuntime;
  let logger: ILogger;
  const cleanupFns: Array<() => Promise<void>> = [];

  beforeEach(() => {
    logger = createMockLogger();
    runtime = new WasmoonRuntime(logger);
  });

  afterEach(async () => {
    // Clean up all servers and clients
    for (const cleanup of cleanupFns) {
      await cleanup();
    }
    cleanupFns.length = 0;
  });

  describe("basic Lua execution", () => {
    it("should execute simple Lua script and return result", async () => {
      const script = `
        result = 42
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toBe(42);
    });

    it("should execute Lua math operations", async () => {
      const script = `
        result = 10 + 5 * 2
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toBe(20);
    });

    it("should return string results", async () => {
      const script = `
        result = "hello world"
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toBe("hello world");
    });

    it("should return table results", async () => {
      const script = `
        result = { name = "test", value = 123 }
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toEqual({ name: "test", value: 123 });
    });

    it("should return nil when no result is set", async () => {
      const script = `
        -- No result set
        local x = 42
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toBeNull();
    });
  });

  describe("sandboxing", () => {
    it("should not have access to os module", async () => {
      const script = `
        result = os
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toBeNull();
    });

    it("should not have access to io module", async () => {
      const script = `
        result = io
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toBeNull();
    });

    it("should not have access to require", async () => {
      const script = `
        result = require
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toBeNull();
    });

    it("should not have access to dofile", async () => {
      const script = `
        result = dofile
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toBeNull();
    });

    it("should not have access to loadfile", async () => {
      const script = `
        result = loadfile
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toBeNull();
    });

    it("should not have access to debug module", async () => {
      const script = `
        result = debug
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toBeNull();
    });

    it("should have access to safe modules like math", async () => {
      const script = `
        result = math.floor(3.7)
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toBe(3);
    });

    it("should have access to safe modules like string", async () => {
      const script = `
        result = string.upper("hello")
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toBe("HELLO");
    });

    it("should have access to safe modules like table", async () => {
      const script = `
        local t = {1, 2, 3}
        table.insert(t, 4)
        result = #t
      `;

      const result = await runtime.executeScript(script, new Map());
      expect(result).toBe(4);
    });
  });

  describe("MCP server injection", () => {
    it("should inject MCP server as global", async () => {
      const { server, client } = await createTestServer("test-server", [
        {
          name: "test-tool",
          description: "A test tool",
          handler: async () => ({
            content: [{ type: "text" as const, text: "test result" }],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["test-server", client]]);

      const script = `
        result = test_server ~= nil
      `;

      const result = await runtime.executeScript(script, servers);
      expect(result).toBe(true);
    });

    it("should sanitize server names to valid Lua identifiers", async () => {
      const { server, client } = await createTestServer("test-server", [
        {
          name: "tool",
          description: "A tool",
          handler: async () => ({
            content: [{ type: "text" as const, text: "result" }],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["test-server", client]]);

      const script = `
        -- Should be accessible as test_server (hyphen → underscore)
        result = test_server ~= nil
      `;

      const result = await runtime.executeScript(script, servers);
      expect(result).toBe(true);
    });

    it("should inject tools as functions on server object", async () => {
      const { server, client } = await createTestServer("my-server", [
        {
          name: "get-data",
          description: "Get data",
          handler: async () => ({
            content: [{ type: "text" as const, text: "data" }],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["my-server", client]]);

      const script = `
        result = type(my_server.get_data) == "function"
      `;

      const result = await runtime.executeScript(script, servers);
      expect(result).toBe(true);
    });

    it("should sanitize tool names to valid Lua identifiers", async () => {
      const { server, client } = await createTestServer("server", [
        {
          name: "get-data",
          description: "Get data",
          handler: async () => ({
            content: [{ type: "text" as const, text: "data" }],
          }),
        },
        {
          name: "process.info",
          description: "Process info",
          handler: async () => ({
            content: [{ type: "text" as const, text: "info" }],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["server", client]]);

      const script = `
        -- Tools should have sanitized names
        local hasGetData = type(server.get_data) == "function"
        local hasProcessInfo = type(server.process_info) == "function"
        result = hasGetData and hasProcessInfo
      `;

      const result = await runtime.executeScript(script, servers);
      expect(result).toBe(true);
    });

    it("should inject multiple servers", async () => {
      const { server: server1, client: client1 } = await createTestServer(
        "server1",
        [
          {
            name: "tool1",
            description: "Tool 1",
            handler: async () => ({
              content: [{ type: "text" as const, text: "result1" }],
            }),
          },
        ],
      );
      const { server: server2, client: client2 } = await createTestServer(
        "server2",
        [
          {
            name: "tool2",
            description: "Tool 2",
            handler: async () => ({
              content: [{ type: "text" as const, text: "result2" }],
            }),
          },
        ],
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

      const servers = new Map([
        ["server1", client1],
        ["server2", client2],
      ]);

      const script = `
        result = (server1 ~= nil) and (server2 ~= nil)
      `;

      const result = await runtime.executeScript(script, servers);
      expect(result).toBe(true);
    });
  });

  describe("MCP tool calling", () => {
    it("should call MCP tool with arguments", async () => {
      const handler = vi.fn(async (args: Record<string, unknown>) => {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(args) }],
        };
      });

      const { server, client } = await createTestServer("server", [
        {
          name: "test-tool",
          description: "Test tool",
          handler,
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["server", client]]);

      const script = `
        local result_obj = server.test_tool({ arg1 = "value1", arg2 = 42 }):await()
        result = true
      `;

      await runtime.executeScript(script, servers);

      expect(handler).toHaveBeenCalledWith({ arg1: "value1", arg2: 42 });
    });

    it("should return tool call results", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "get-value",
          description: "Get value",
          handler: async () => ({
            content: [{ type: "text" as const, text: '{"result": 123}' }],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["api", client]]);

      const script = `
        result = api.get_value({})
      `;

      const result = await runtime.executeScript(script, servers);
      expect(result).toEqual({
        content: [{ type: "text", text: '{"result": 123}' }],
      });
    });

    it("should call tools with empty arguments", async () => {
      const handler = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "pong" }],
      }));

      const { server, client } = await createTestServer("server", [
        {
          name: "ping",
          description: "Ping",
          handler,
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["server", client]]);

      const script = `
        server.ping({}):await()
        result = true
      `;

      await runtime.executeScript(script, servers);

      expect(handler).toHaveBeenCalledWith({});
    });

    it("should directly return structuredContent if present", async () => {
      const { server, client } = await createTestServer("data-server", [
        {
          name: "fetch-data",
          description: "Fetch data",
          handler: async () => {
            return {
              content: [],
              structuredContent: {
                type: "article",
                title: "Test Article",
                body: "This is a test article.",
              },
            };
          },
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["data-server", client]]);
      const script = `
        result = data_server.fetch_data({}):await()
      `;

      const result = await runtime.executeScript(script, servers);
      expect(result).toEqual({
        type: "article",
        title: "Test Article",
        body: "This is a test article.",
      });
    });
  });

  describe("error handling", () => {
    it("should throw error for invalid Lua syntax", async () => {
      const script = `
        this is not valid lua syntax !!!
      `;

      await expect(runtime.executeScript(script, new Map())).rejects.toThrow();
    });

    it("should throw error for undefined variables", async () => {
      const script = `
        result = undefined_variable
      `;

      // Lua allows undefined variables and returns nil, not an error
      const result = await runtime.executeScript(script, new Map());
      expect(result).toBeNull();
    });

    it("should log errors on script failure", async () => {
      const script = `
        error("intentional error")
      `;

      await expect(runtime.executeScript(script, new Map())).rejects.toThrow();

      expect(logger.error).toHaveBeenCalled();
    });

    it("should continue if one server fails to load tools", async () => {
      const { server, client } = await createTestServer("good-server", [
        {
          name: "tool",
          description: "A tool",
          handler: async () => ({
            content: [{ type: "text" as const, text: "result" }],
          }),
        },
      ]);

      // Create a bad client that throws on listTools
      const badClient = {
        listTools: vi.fn().mockRejectedValue(new Error("Failed to list tools")),
      } as unknown as MCPClientSession;

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([
        ["good-server", client],
        ["bad-server", badClient],
      ]);

      const script = `
        -- Good server should still be accessible
        result = good_server ~= nil
      `;

      const result = await runtime.executeScript(script, servers);
      expect(result).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to inject MCP server 'bad-server'"),
        expect.any(Error),
      );
    });
  });

  describe("complex scenarios", () => {
    it("should allow combining multiple tool calls", async () => {
      const { server: server1, client: client1 } = await createTestServer(
        "api",
        [
          {
            name: "get",
            description: "Get",
            handler: async () => ({
              content: [{ type: "text" as const, text: "data" }],
            }),
          },
        ],
      );
      const { server: server2, client: client2 } = await createTestServer(
        "processor",
        [
          {
            name: "process",
            description: "Process",
            handler: async () => ({
              content: [{ type: "text" as const, text: "processed" }],
            }),
          },
        ],
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

      const servers = new Map([
        ["api", client1],
        ["processor", client2],
      ]);

      const script = `
        local data = api.get({}):await()
        local processed = processor.process({ input = data }):await()
        result = { data = data, processed = processed }
      `;

      const result = await runtime.executeScript(script, servers);
      expect(result).toEqual({
        data: { content: [{ type: "text", text: "data" }] },
        processed: { content: [{ type: "text", text: "processed" }] },
      });
    });

    it("should work with Lua control flow", async () => {
      const handler = vi.fn(async (args: Record<string, unknown>) => {
        return {
          content: [{ type: "text" as const, text: `checked ${args.index}` }],
        };
      });

      const { server, client } = await createTestServer("server", [
        {
          name: "check",
          description: "Check something",
          handler,
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["server", client]]);

      const script = `
        local results = {}
        for i = 1, 3 do
          results[i] = server.check({ index = i }):await()
        end
        result = #results
      `;

      const result = await runtime.executeScript(script, servers);
      expect(result).toBe(3);
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it("should handle nested tables in arguments", async () => {
      const handler = vi.fn(async (args: Record<string, unknown>) => {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(args) }],
        };
      });

      const { server, client } = await createTestServer("api", [
        {
          name: "complex",
          description: "Complex tool",
          handler,
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["api", client]]);

      const script = `
        api.complex({
          nested = {
            deep = {
              value = 123
            }
          }
        }):await()
        result = true
      `;

      await runtime.executeScript(script, servers);

      expect(handler).toHaveBeenCalledWith({
        nested: {
          deep: {
            value: 123,
          },
        },
      });
    });
  });
});
