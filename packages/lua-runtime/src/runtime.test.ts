import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WasmoonRuntime } from "./runtime.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as z from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  ILogger,
  IMCPClientSession,
  IGatewayBuiltins,
  IToolCallLog,
} from "./types.js";

// Mock logger factory
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
});

// Mock gateway builtins factory - provides minimal implementation for tests
const createMockGatewayBuiltins = (): IGatewayBuiltins => ({
  listResources: vi.fn().mockResolvedValue({ resources: [] }),
  listResourceTemplates: vi.fn().mockResolvedValue({ resourceTemplates: [] }),
  readResource: vi.fn().mockResolvedValue({ contents: [] }),
  listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
  getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
  summaryStats: vi.fn().mockResolvedValue({ servers: 0, tools: 0 }),
  complete: vi
    .fn()
    .mockResolvedValue({ completion: { values: [], hasMore: false } }),
});

/**
 * Minimal MCPClientSession wrapper for tests.
 * This wraps the SDK Client to match the IMCPClientSession interface.
 */
class TestMCPClientSession implements IMCPClientSession {
  constructor(
    private client: Client,
    private serverName: string,
  ) {}

  async listTools() {
    const result = await this.client.listTools();
    return result.tools;
  }

  get experimental() {
    return this.client.experimental as IMCPClientSession["experimental"];
  }

  async close() {
    await this.client.close();
  }
}

// Helper to create a test MCP server with tools
async function createTestServer(
  name: string,
  tools: Array<{
    name: string;
    description: string;
    handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
  }>,
): Promise<{ server: McpServer; client: IMCPClientSession }> {
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

  // Wrap in test MCPClientSession
  const mcpClientSession = new TestMCPClientSession(client, name);

  return { server, client: mcpClientSession };
}

describe("WasmoonRuntime", () => {
  let runtime: WasmoonRuntime;
  let logger: ILogger;
  const cleanupFns: Array<() => Promise<void>> = [];

  beforeEach(async () => {
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
        result(42)
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toBe(42);
    });

    it("should provide helpful error for shadowed result function", async () => {
      const script = `
        local result = github.search_issues({ query = "test" }):await()
        result(result)  -- This tries to call the returned data as function
      `;

      // Create mock server and client manually
      const { server, client } = await createTestServer("github", [
        {
          name: "search_issues",
          description: "Search issues",
          handler: async () => ({
            content: [{ type: "text", text: "No results found" }],
            isError: false,
          }),
        },
      ]);
      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const error = await runtime
        .executeScript(
          script,
          new Map([["github", client]]),
          createMockGatewayBuiltins(),
        )
        .catch((err) => err);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "TypeError: self is not a function",
      );
      expect((error as Error).message).toContain(
        "HINT: You may have shadowed the global 'result' function",
      );
    });

    it("should provide helpful error for non-existent server", async () => {
      const script = `
        result(nonexistent_server.some_tool():await())
      `;

      // Create a different server so we have something to suggest
      const { server, client } = await createTestServer("my-api", [
        {
          name: "tool",
          description: "A tool",
          handler: async () => ({
            content: [{ type: "text", text: "result" }],
          }),
        },
      ]);
      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const error = await runtime
        .executeScript(
          script,
          new Map([["my-api", client]]),
          createMockGatewayBuiltins(),
        )
        .catch((err) => err);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "attempt to index a nil value (global 'nonexistent_server')",
      );
      expect((error as Error).message).toContain(
        "HINT: 'nonexistent_server' is not a recognized server",
      );
      expect((error as Error).message).toContain("Available servers: my_api");
    });

    it("should provide helpful error for non-existent tool", async () => {
      const script = `
        result(my_api.nonexistent_tool():await())
      `;

      // Create server with a different tool name
      const { server, client } = await createTestServer("my-api", [
        {
          name: "actual-tool",
          description: "The actual tool",
          handler: async () => ({
            content: [{ type: "text", text: "result" }],
          }),
        },
      ]);
      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const error = await runtime
        .executeScript(
          script,
          new Map([["my-api", client]]),
          createMockGatewayBuiltins(),
        )
        .catch((err) => err);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "attempt to call a nil value (field 'nonexistent_tool')",
      );
      expect((error as Error).message).toContain(
        "HINT: 'nonexistent_tool' is not a recognized tool",
      );
      expect((error as Error).message).toContain("list-server-tools");
    });

    it("should execute Lua math operations", async () => {
      const script = `
        result(10 + 5 * 2)
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toBe(20);
    });

    it("should return string results", async () => {
      const script = `
        result("hello world")
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toBe("hello world");
    });

    it("should return table results", async () => {
      const script = `
        result({ name = "test", value = 123 })
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toEqual({ name: "test", value: 123 });
    });

    it("should return nil when no result is set", async () => {
      const script = `
        -- No result set
        local x = 42
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toBeUndefined();
    });
  });

  describe("sandboxing", () => {
    it("should not have access to os module", async () => {
      const script = `
        result(os)
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toBeNull();
    });

    it("should not have access to io module", async () => {
      const script = `
        result(io)
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toBeNull();
    });

    it("should not have access to require", async () => {
      const script = `
        result(require)
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toBeNull();
    });

    it("should not have access to dofile", async () => {
      const script = `
        result(dofile)
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toBeNull();
    });

    it("should not have access to loadfile", async () => {
      const script = `
        result(loadfile)
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toBeNull();
    });

    it("should not have access to debug module", async () => {
      const script = `
        result(debug)
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toBeNull();
    });

    it("should have access to safe modules like math", async () => {
      const script = `
        result(math.floor(3.7))
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toBe(3);
    });

    it("should have access to safe modules like string", async () => {
      const script = `
        result(string.upper("hello"))
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toBe("HELLO");
    });

    it("should have access to safe modules like table", async () => {
      const script = `
        local t = {1, 2, 3}
        table.insert(t, 4)
        result(#t)
      `;

      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
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
        result(test_server ~= nil)
      `;

      const result = await runtime.executeScript(
        script,
        servers,
        createMockGatewayBuiltins(),
      );
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
        -- Should be accessible as test_server (hyphen -> underscore)
        result(test_server ~= nil)
      `;

      const result = await runtime.executeScript(
        script,
        servers,
        createMockGatewayBuiltins(),
      );
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
        result(type(my_server.get_data) == "function")
      `;

      const result = await runtime.executeScript(
        script,
        servers,
        createMockGatewayBuiltins(),
      );
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
        result(hasGetData and hasProcessInfo)
      `;

      const result = await runtime.executeScript(
        script,
        servers,
        createMockGatewayBuiltins(),
      );
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
        result((server1 ~= nil) and (server2 ~= nil))
      `;

      const result = await runtime.executeScript(
        script,
        servers,
        createMockGatewayBuiltins(),
      );
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
        result(true)
      `;

      await runtime.executeScript(script, servers, createMockGatewayBuiltins());

      expect(handler).toHaveBeenCalledWith({ arg1: "value1", arg2: 42 });
    });

    it("should return tool call results", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "get-value",
          description: "Get value",
          handler: async () => ({
            content: [{ type: "text" as const, text: "Hello, world!" }],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["api", client]]);

      const script = `
        result(api.get_value({}))
      `;

      const result = await runtime.executeScript(
        script,
        servers,
        createMockGatewayBuiltins(),
      );
      expect(result).toEqual({
        content: [{ type: "text", text: "Hello, world!" }],
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
        result(true)
      `;

      await runtime.executeScript(script, servers, createMockGatewayBuiltins());

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
        result(data_server.fetch_data({}):await())
      `;

      const result = await runtime.executeScript(
        script,
        servers,
        createMockGatewayBuiltins(),
      );
      expect(result).toEqual({
        type: "article",
        title: "Test Article",
        body: "This is a test article.",
      });
    });

    it("should parse JSON results from tool calls", async () => {
      const { server, client } = await createTestServer("json-server", [
        {
          name: "get-json",
          description: "Get JSON",
          handler: async () => ({
            content: [{ type: "text" as const, text: '{"key": "value"}' }],
          }),
        },
      ]);
      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["json-server", client]]);
      const script = `
        result(json_server.get_json({}):await())
      `;

      const result = await runtime.executeScript(
        script,
        servers,
        createMockGatewayBuiltins(),
      );
      expect(result).toEqual({ key: "value" });
    });
  });

  describe("isError validation", () => {
    it("should throw when a tool call returns isError: true", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "failing-tool",
          description: "A tool that returns an error",
          handler: async () => ({
            content: [
              {
                type: "text" as const,
                text: "Something went wrong: invalid input",
              },
            ],
            isError: true,
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["api", client]]);

      const script = `
        local data = api.failing_tool({}):await()
        result(data)
      `;

      await expect(
        runtime.executeScript(script, servers, createMockGatewayBuiltins()),
      ).rejects.toThrow(/isError/);
    });

    it("should include tool result content in the error when isError is true", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "bad-tool",
          description: "Returns error",
          handler: async () => ({
            content: [{ type: "text" as const, text: "Rate limit exceeded" }],
            isError: true,
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["api", client]]);

      const script = `
        local data = api.bad_tool({}):await()
        result(data)
      `;

      const error = await runtime
        .executeScript(script, servers, createMockGatewayBuiltins())
        .catch((err) => err);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("Rate limit exceeded");
      expect((error as Error).message).toContain("api");
      expect((error as Error).message).toContain("bad-tool");
    });

    it("should concatenate multiple text content blocks in the error message", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "multi-error",
          description: "Returns error with multiple text blocks",
          handler: async () => ({
            content: [
              { type: "text" as const, text: "Error: validation failed" },
              { type: "text" as const, text: "Field 'name' is required" },
              { type: "text" as const, text: "Field 'email' must be valid" },
            ],
            isError: true,
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["api", client]]);

      const script = `
        result(api.multi_error({}):await())
      `;

      const error = await runtime
        .executeScript(script, servers, createMockGatewayBuiltins())
        .catch((err) => err);

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("validation failed");
      expect(message).toContain("Field 'name' is required");
      expect(message).toContain("Field 'email' must be valid");
    });

    it("should handle isError with empty content array", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "empty-error",
          description: "Returns error with no content",
          handler: async () => ({
            content: [],
            isError: true,
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["api", client]]);

      const script = `
        result(api.empty_error({}):await())
      `;

      await expect(
        runtime.executeScript(script, servers, createMockGatewayBuiltins()),
      ).rejects.toThrow(/isError/);
    });

    it("should filter non-text content blocks when building error message", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "mixed-error",
          description: "Returns error with mixed content types",
          handler: async () => ({
            content: [
              { type: "text" as const, text: "Something broke" },
              {
                type: "image" as const,
                data: "iVBORw0KGgo=",
                mimeType: "image/png",
              },
              { type: "text" as const, text: "See attached screenshot" },
            ],
            isError: true,
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["api", client]]);

      const script = `
        result(api.mixed_error({}):await())
      `;

      const error = await runtime
        .executeScript(script, servers, createMockGatewayBuiltins())
        .catch((err) => err);

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("Something broke");
      expect(message).toContain("See attached screenshot");
      // Should not contain base64 image data
      expect(message).not.toContain("iVBORw0KGgo=");
    });

    it("should throw on isError even when structuredContent is present", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "structured-error",
          description: "Returns error with structuredContent",
          handler: async () => ({
            content: [
              { type: "text" as const, text: "Structured error occurred" },
            ],
            structuredContent: {
              errorCode: "E_VALIDATION",
              details: { field: "name", reason: "required" },
            },
            isError: true,
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["api", client]]);

      const script = `
        result(api.structured_error({}):await())
      `;

      await expect(
        runtime.executeScript(script, servers, createMockGatewayBuiltins()),
      ).rejects.toThrow(/isError/);
    });

    it("should not throw when isError is false", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "good-tool",
          description: "Returns success",
          handler: async () => ({
            content: [{ type: "text" as const, text: '{"ok": true}' }],
            isError: false,
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["api", client]]);

      const script = `
        result(api.good_tool({}):await())
      `;

      const result = await runtime.executeScript(
        script,
        servers,
        createMockGatewayBuiltins(),
      );
      expect(result).toEqual({ ok: true });
    });
  });

  describe("error handling", () => {
    it("should throw error for invalid Lua syntax", async () => {
      const script = `
        this is not valid lua syntax !!!
      `;

      await expect(
        runtime.executeScript(script, new Map(), createMockGatewayBuiltins()),
      ).rejects.toThrow();
    });

    it("should throw error for undefined variables", async () => {
      const script = `
        result(undefined_variable)
      `;

      // Lua allows undefined variables and returns nil, not an error
      const result = await runtime.executeScript(
        script,
        new Map(),
        createMockGatewayBuiltins(),
      );
      expect(result).toBeNull();
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
      } as unknown as IMCPClientSession;

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
        result(good_server ~= nil)
      `;

      const result = await runtime.executeScript(
        script,
        servers,
        createMockGatewayBuiltins(),
      );
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
        result({ data = data, processed = processed })
      `;

      const result = await runtime.executeScript(
        script,
        servers,
        createMockGatewayBuiltins(),
      );
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
        result(#results)
      `;

      const result = await runtime.executeScript(
        script,
        servers,
        createMockGatewayBuiltins(),
      );
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
        result(true)
      `;

      await runtime.executeScript(script, servers, createMockGatewayBuiltins());

      expect(handler).toHaveBeenCalledWith({
        nested: {
          deep: {
            value: 123,
          },
        },
      });
    });
  });

  describe("resource URI registration from tool results", () => {
    it("should call registerResourceUri for resource_link content blocks", async () => {
      const { server, client } = await createTestServer("data-server", [
        {
          name: "get-link",
          description: "Returns a resource link",
          handler: async () => ({
            content: [
              {
                type: "resource_link" as const,
                name: "Report",
                uri: "file:///data/report.json",
              },
            ],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["data-server", client]]);
      const builtins = createMockGatewayBuiltins();
      const registerResourceUri = vi.fn();
      builtins.registerResourceUri = registerResourceUri;

      const script = `result(data_server.get_link({}):await())`;
      await runtime.executeScript(script, servers, builtins);

      expect(registerResourceUri).toHaveBeenCalledWith(
        "file:///data/report.json",
        "data-server",
      );
    });

    it("should call registerResourceUri for embedded resource content blocks", async () => {
      const { server, client } = await createTestServer("docs-server", [
        {
          name: "get-doc",
          description: "Returns an embedded resource",
          handler: async () => ({
            content: [
              {
                type: "resource" as const,
                resource: {
                  uri: "file:///docs/readme.md",
                  mimeType: "text/markdown",
                  text: "# Hello",
                },
              },
            ],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["docs-server", client]]);
      const builtins = createMockGatewayBuiltins();
      const registerResourceUri = vi.fn();
      builtins.registerResourceUri = registerResourceUri;

      const script = `result(docs_server.get_doc({}):await())`;
      await runtime.executeScript(script, servers, builtins);

      expect(registerResourceUri).toHaveBeenCalledWith(
        "file:///docs/readme.md",
        "docs-server",
      );
    });

    it("should register URIs from multiple content blocks", async () => {
      const { server, client } = await createTestServer("multi-server", [
        {
          name: "get-multi",
          description: "Returns multiple resource references",
          handler: async () => ({
            content: [
              {
                type: "text" as const,
                text: "Here are some resources:",
              },
              {
                type: "resource_link" as const,
                name: "Report A",
                uri: "file:///a.json",
              },
              {
                type: "resource" as const,
                resource: {
                  uri: "file:///b.md",
                  mimeType: "text/markdown",
                  text: "# B",
                },
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
      const builtins = createMockGatewayBuiltins();
      const registerResourceUri = vi.fn();
      builtins.registerResourceUri = registerResourceUri;

      const script = `result(multi_server.get_multi({}):await())`;
      await runtime.executeScript(script, servers, builtins);

      expect(registerResourceUri).toHaveBeenCalledTimes(2);
      expect(registerResourceUri).toHaveBeenCalledWith(
        "file:///a.json",
        "multi-server",
      );
      expect(registerResourceUri).toHaveBeenCalledWith(
        "file:///b.md",
        "multi-server",
      );
    });

    it("should not call registerResourceUri for text-only content", async () => {
      const { server, client } = await createTestServer("text-server", [
        {
          name: "get-text",
          description: "Returns only text",
          handler: async () => ({
            content: [{ type: "text" as const, text: "just text" }],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["text-server", client]]);
      const builtins = createMockGatewayBuiltins();
      const registerResourceUri = vi.fn();
      builtins.registerResourceUri = registerResourceUri;

      const script = `result(text_server.get_text({}):await())`;
      await runtime.executeScript(script, servers, builtins);

      expect(registerResourceUri).not.toHaveBeenCalled();
    });

    it("should not fail when registerResourceUri is not provided", async () => {
      const { server, client } = await createTestServer("link-server", [
        {
          name: "get-link",
          description: "Returns a resource link",
          handler: async () => ({
            content: [
              {
                type: "resource_link" as const,
                name: "Report",
                uri: "file:///report.json",
              },
            ],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const servers = new Map([["link-server", client]]);
      // No registerResourceUri on builtins — should not throw
      const builtins = createMockGatewayBuiltins();

      const script = `result(link_server.get_link({}):await())`;
      await expect(
        runtime.executeScript(script, servers, builtins),
      ).resolves.not.toThrow();
    });
  });

  describe("gateway complete builtin", () => {
    it("should call complete builtin with ref and argument params", async () => {
      const builtins = createMockGatewayBuiltins();
      const mockComplete = vi.fn().mockResolvedValue({
        completion: { values: ["us-east-1", "us-west-2"], hasMore: false },
      });
      builtins.complete = mockComplete;

      const script = `
        local res = _gateway.complete({
          ref = { type = "ref/resource", uri = "deployment://{region}/{service}" },
          argument = { name = "region", value = "us" }
        }):await()
        result(res)
      `;

      const result = await runtime.executeScript(script, new Map(), builtins);

      expect(mockComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: expect.objectContaining({
            type: "ref/resource",
            uri: "deployment://{region}/{service}",
          }),
          argument: expect.objectContaining({
            name: "region",
            value: "us",
          }),
        }),
      );

      const typed = result as {
        completion: { values: string[]; hasMore: boolean };
      };
      expect(typed.completion.values).toContain("us-east-1");
      expect(typed.completion.values).toContain("us-west-2");
    });

    it("should call complete builtin with ref/prompt type", async () => {
      const builtins = createMockGatewayBuiltins();
      const mockComplete = vi.fn().mockResolvedValue({
        completion: { values: ["typescript", "terraform"], hasMore: false },
      });
      builtins.complete = mockComplete;

      const script = `
        local res = _gateway.complete({
          ref = { type = "ref/prompt", name = "my-server/code-review" },
          argument = { name = "language", value = "type" }
        }):await()
        result(res)
      `;

      const result = await runtime.executeScript(script, new Map(), builtins);

      expect(mockComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: expect.objectContaining({
            type: "ref/prompt",
            name: "my-server/code-review",
          }),
          argument: expect.objectContaining({
            name: "language",
            value: "type",
          }),
        }),
      );

      const typed = result as {
        completion: { values: string[]; hasMore: boolean };
      };
      expect(typed.completion.values).toEqual(["typescript", "terraform"]);
    });

    it("should pass context.arguments through to complete builtin", async () => {
      const builtins = createMockGatewayBuiltins();
      const mockComplete = vi.fn().mockResolvedValue({
        completion: { values: ["express", "fastify"], hasMore: false },
      });
      builtins.complete = mockComplete;

      const script = `
        local res = _gateway.complete({
          ref = { type = "ref/prompt", name = "my-server/code-review" },
          argument = { name = "framework", value = "" },
          context = { arguments = { language = "typescript" } }
        }):await()
        result(res)
      `;

      const result = await runtime.executeScript(script, new Map(), builtins);

      expect(mockComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            arguments: expect.objectContaining({
              language: "typescript",
            }),
          }),
        }),
      );

      const typed = result as {
        completion: { values: string[]; hasMore: boolean };
      };
      expect(typed.completion.values).toEqual(["express", "fastify"]);
    });

    it("should return error object when complete builtin rejects", async () => {
      const builtins = createMockGatewayBuiltins();
      builtins.complete = vi
        .fn()
        .mockRejectedValue(new Error("No route found for resource URI"));

      const script = `
        local ok, err = pcall(function()
          return _gateway.complete({
            ref = { type = "ref/resource", uri = "unknown://{id}" },
            argument = { name = "id", value = "test" }
          }):await()
        end)
        result({ ok = ok, error_message = tostring(err) })
      `;

      const result = await runtime.executeScript(script, new Map(), builtins);

      const typed = result as { ok: boolean; error_message: string };
      expect(typed.ok).toBe(false);
      expect(typed.error_message).toContain("No route found");
    });

    it("should handle empty completion results", async () => {
      const builtins = createMockGatewayBuiltins();
      builtins.complete = vi.fn().mockResolvedValue({
        completion: { values: [], hasMore: false },
      });

      const script = `
        local res = _gateway.complete({
          ref = { type = "ref/resource", uri = "deployment://{region}/{service}" },
          argument = { name = "region", value = "zzz" }
        }):await()
        result(res)
      `;

      const result = await runtime.executeScript(script, new Map(), builtins);

      const typed = result as {
        completion: { values: string[]; hasMore: boolean };
      };
      expect(typed.completion.values).toEqual([]);
      expect(typed.completion.hasMore).toBe(false);
    });
  });

  describe("toolCallLog integration", () => {
    it("should call onToolCallStart for each tool invocation", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "get-data",
          description: "Get data",
          handler: async () => ({
            content: [{ type: "text" as const, text: '{"ok":true}' }],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const toolCallLog: IToolCallLog = {
        onToolCallStart: vi.fn().mockReturnValue("call-1"),
        onToolCallEnd: vi.fn(),
        onToolCallError: vi.fn(),
      };

      const script = `result(api.get_data({}):await())`;
      await runtime.executeScript(
        script,
        new Map([["api", client]]),
        createMockGatewayBuiltins(),
        undefined,
        toolCallLog,
      );

      expect(toolCallLog.onToolCallStart).toHaveBeenCalledWith(
        "api",
        "get-data",
        expect.any(String),
      );
    });

    it("should call onToolCallStart for each tool call in a multi-call script", async () => {
      const { server, client } = await createTestServer("svc", [
        {
          name: "tool-a",
          description: "A",
          handler: async () => ({
            content: [{ type: "text" as const, text: "a" }],
          }),
        },
        {
          name: "tool-b",
          description: "B",
          handler: async () => ({
            content: [{ type: "text" as const, text: "b" }],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const toolCallLog: IToolCallLog = {
        onToolCallStart: vi.fn().mockReturnValue("call-id"),
        onToolCallEnd: vi.fn(),
        onToolCallError: vi.fn(),
      };

      const script = `
        svc.tool_a({}):await()
        svc.tool_b({}):await()
        result(true)
      `;

      await runtime.executeScript(
        script,
        new Map([["svc", client]]),
        createMockGatewayBuiltins(),
        undefined,
        toolCallLog,
      );

      expect(toolCallLog.onToolCallStart).toHaveBeenCalledTimes(2);
      expect(toolCallLog.onToolCallStart).toHaveBeenCalledWith(
        "svc",
        "tool-a",
        expect.any(String),
      );
      expect(toolCallLog.onToolCallStart).toHaveBeenCalledWith(
        "svc",
        "tool-b",
        expect.any(String),
      );
    });

    it("should call onToolCallError when a tool call fails", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "failing",
          description: "Fails",
          handler: async () => ({
            content: [{ type: "text" as const, text: "bad" }],
            isError: true,
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const toolCallLog: IToolCallLog = {
        onToolCallStart: vi.fn().mockReturnValue("call-42"),
        onToolCallEnd: vi.fn(),
        onToolCallError: vi.fn(),
      };

      const script = `result(api.failing({}):await())`;

      await runtime
        .executeScript(
          script,
          new Map([["api", client]]),
          createMockGatewayBuiltins(),
          undefined,
          toolCallLog,
        )
        .catch(() => {});

      expect(toolCallLog.onToolCallStart).toHaveBeenCalledTimes(1);
      expect(toolCallLog.onToolCallError).toHaveBeenCalledWith(
        "call-42",
        expect.stringContaining("isError"),
      );
    });

    it("should call onToolCallEnd with serialized result on success", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "get-data",
          description: "Get data",
          handler: async () => ({
            content: [{ type: "text" as const, text: '{"ok":true}' }],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const toolCallLog: IToolCallLog = {
        onToolCallStart: vi.fn().mockReturnValue("call-1"),
        onToolCallEnd: vi.fn(),
        onToolCallError: vi.fn(),
      };

      const script = `result(api.get_data({}):await())`;
      await runtime.executeScript(
        script,
        new Map([["api", client]]),
        createMockGatewayBuiltins(),
        undefined,
        toolCallLog,
      );

      expect(toolCallLog.onToolCallEnd).toHaveBeenCalledWith(
        "call-1",
        expect.any(String),
      );
      // The result should be valid JSON
      const endCalls = (toolCallLog.onToolCallEnd as ReturnType<typeof vi.fn>)
        .mock.calls;
      const firstEndCall = endCalls[0];
      if (!firstEndCall)
        throw new Error("Expected onToolCallEnd to have been called");
      const resultArg = firstEndCall[1];
      const parsed = JSON.parse(resultArg as string);
      expect(parsed).toHaveProperty("content");
    });

    it("should not call onToolCallEnd when a tool call fails", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "failing",
          description: "Fails",
          handler: async () => ({
            content: [{ type: "text" as const, text: "bad" }],
            isError: true,
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const toolCallLog: IToolCallLog = {
        onToolCallStart: vi.fn().mockReturnValue("call-1"),
        onToolCallEnd: vi.fn(),
        onToolCallError: vi.fn(),
      };

      const script = `result(api.failing({}):await())`;
      await runtime
        .executeScript(
          script,
          new Map([["api", client]]),
          createMockGatewayBuiltins(),
          undefined,
          toolCallLog,
        )
        .catch(() => {});

      expect(toolCallLog.onToolCallEnd).not.toHaveBeenCalled();
      expect(toolCallLog.onToolCallError).toHaveBeenCalled();
    });

    it("should not fail when toolCallLog is not provided", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "tool",
          description: "A tool",
          handler: async () => ({
            content: [{ type: "text" as const, text: '{"ok":true}' }],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const script = `result(api.tool({}):await())`;

      // Should not throw even without toolCallLog
      await expect(
        runtime.executeScript(
          script,
          new Map([["api", client]]),
          createMockGatewayBuiltins(),
        ),
      ).resolves.not.toThrow();
    });

    it("should pass JSON-serialized arguments to onToolCallStart", async () => {
      const { server, client } = await createTestServer("api", [
        {
          name: "search",
          description: "Search",
          handler: async () => ({
            content: [{ type: "text" as const, text: "[]" }],
          }),
        },
      ]);

      cleanupFns.push(async () => {
        await client.close();
        await server.close();
      });

      const toolCallLog: IToolCallLog = {
        onToolCallStart: vi.fn().mockReturnValue("call-1"),
        onToolCallEnd: vi.fn(),
        onToolCallError: vi.fn(),
      };

      const script = `result(api.search({ query = "test", limit = 10 }):await())`;
      await runtime.executeScript(
        script,
        new Map([["api", client]]),
        createMockGatewayBuiltins(),
        undefined,
        toolCallLog,
      );

      const startCalls = (
        toolCallLog.onToolCallStart as ReturnType<typeof vi.fn>
      ).mock.calls;
      const firstStartCall = startCalls[0];
      if (!firstStartCall)
        throw new Error("Expected onToolCallStart to have been called");
      const args = firstStartCall[2];
      const parsed = JSON.parse(args as string);
      expect(parsed).toEqual({ query: "test", limit: 10 });
    });
  });
});
