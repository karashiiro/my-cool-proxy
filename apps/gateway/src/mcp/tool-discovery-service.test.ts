import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TestBed } from "@suites/unit";
import { ToolDiscoveryService } from "./tool-discovery-service.js";
import { TYPES } from "../types/index.js";
import type { MCPClientSession } from "./client-session.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

describe("ToolDiscoveryService", () => {
  let service: ToolDiscoveryService;
  let mockClientManager: ReturnType<typeof unitRef.get>;
  let mockLogger: ReturnType<typeof unitRef.get>;
  let mockFormatter: ReturnType<typeof unitRef.get>;
  let mockLuaRuntime: ReturnType<typeof unitRef.get>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let unitRef: any;

  beforeEach(async () => {
    const { unit, unitRef: ref } =
      await TestBed.solitary(ToolDiscoveryService).compile();
    service = unit;
    unitRef = ref;
    mockClientManager = unitRef.get(TYPES.MCPClientManager);
    mockLogger = unitRef.get(TYPES.Logger);
    mockFormatter = unitRef.get(TYPES.MCPFormatterService);
    mockLuaRuntime = unitRef.get(TYPES.LuaRuntime);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("listServers", () => {
    it("should return formatted list of connected servers", async () => {
      const mockClient = createMockClientSession({
        serverVersion: { name: "test-server", version: "1.0.0" },
        instructions: "Test instructions",
      });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);
      const failedServersMap = new Map<string, string>();

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockClientManager.getFailedServers.mockReturnValue(failedServersMap);
      mockFormatter.formatServerList.mockReturnValue("Formatted server list");

      const result = await service.listServers("session-123");

      expect(mockClientManager.getClientsBySession).toHaveBeenCalledWith(
        "session-123",
      );
      expect(mockFormatter.formatServerList).toHaveBeenCalledWith(
        "session-123",
        expect.arrayContaining([
          expect.objectContaining({
            luaIdentifier: "server1",
            serverInfo: expect.objectContaining({
              name: "test-server",
              version: "1.0.0",
            }),
          }),
        ]),
      );
      expect(result).toEqual({
        content: [{ type: "text", text: "Formatted server list" }],
      });
    });

    it("should use 'default' session when sessionId is empty", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      const failedServersMap = new Map<string, string>();

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockClientManager.getFailedServers.mockReturnValue(failedServersMap);
      mockFormatter.formatServerList.mockReturnValue("Empty list");

      await service.listServers("");

      expect(mockClientManager.getClientsBySession).toHaveBeenCalledWith(
        "default",
      );
      expect(mockFormatter.formatServerList).toHaveBeenCalledWith(
        "default",
        [],
      );
    });

    it("should include failed servers with error status", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      const failedServersMap = new Map<string, string>([
        ["failed-server", "Connection refused"],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockClientManager.getFailedServers.mockReturnValue(failedServersMap);
      mockFormatter.formatServerList.mockReturnValue("List with failed server");

      await service.listServers("session-123");

      expect(mockFormatter.formatServerList).toHaveBeenCalledWith(
        "session-123",
        expect.arrayContaining([
          expect.objectContaining({
            luaIdentifier: "failed_server",
            error: "Connection failed",
          }),
        ]),
      );
    });

    it("should sanitize server names for Lua identifiers", async () => {
      const mockClient = createMockClientSession({
        serverVersion: { name: "My Server" },
      });

      const clientsMap = new Map<string, MCPClientSession>([
        ["my-cool-server", mockClient as unknown as MCPClientSession],
      ]);
      const failedServersMap = new Map<string, string>();

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockClientManager.getFailedServers.mockReturnValue(failedServersMap);
      mockFormatter.formatServerList.mockReturnValue("Formatted");

      await service.listServers("session-123");

      expect(mockFormatter.formatServerList).toHaveBeenCalledWith(
        "session-123",
        expect.arrayContaining([
          expect.objectContaining({
            luaIdentifier: "my_cool_server",
          }),
        ]),
      );
    });

    it("should handle errors from getServerVersion gracefully", async () => {
      const mockClient = createMockClientSession({});
      mockClient.getServerVersion.mockImplementation(() => {
        throw new Error("Version unavailable");
      });

      const clientsMap = new Map<string, MCPClientSession>([
        ["error-server", mockClient as unknown as MCPClientSession],
      ]);
      const failedServersMap = new Map<string, string>();

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockClientManager.getFailedServers.mockReturnValue(failedServersMap);
      mockFormatter.formatServerList.mockReturnValue("List with error");

      await service.listServers("session-123");

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockFormatter.formatServerList).toHaveBeenCalledWith(
        "session-123",
        expect.arrayContaining([
          expect.objectContaining({
            luaIdentifier: "error_server",
            error: expect.stringContaining("Failed to retrieve server info"),
          }),
        ]),
      );
    });

    it("should return error result when listServers throws", async () => {
      mockClientManager.getClientsBySession.mockImplementation(() => {
        throw new Error("Session not found");
      });

      const result = await service.listServers("invalid-session");

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: expect.stringContaining("Failed to list servers"),
          },
        ],
        isError: true,
      });
    });

    it("should handle instructions being unavailable", async () => {
      const mockClient = createMockClientSession({
        serverVersion: { name: "test-server" },
      });
      mockClient.getInstructions.mockImplementation(() => {
        throw new Error("Instructions not available");
      });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockClientManager.getFailedServers.mockReturnValue(new Map());
      mockFormatter.formatServerList.mockReturnValue("Formatted");

      await service.listServers("session-123");

      expect(mockFormatter.formatServerList).toHaveBeenCalledWith(
        "session-123",
        expect.arrayContaining([
          expect.objectContaining({
            serverInfo: expect.objectContaining({
              instructions: undefined,
            }),
          }),
        ]),
      );
    });
  });

  describe("listServerTools", () => {
    it("should return formatted list of tools for a server", async () => {
      const mockTools: Tool[] = [
        {
          name: "tool1",
          description: "First tool",
          inputSchema: { type: "object" },
        },
        {
          name: "tool2",
          description: "Second tool",
          inputSchema: { type: "object" },
        },
      ];
      const mockClient = createMockClientSession({ tools: mockTools });

      const clientsMap = new Map<string, MCPClientSession>([
        ["my_server", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockFormatter.formatToolList.mockReturnValue("Formatted tool list");

      const result = await service.listServerTools("my_server", "session-123");

      expect(mockClient.listTools).toHaveBeenCalled();
      expect(mockFormatter.formatToolList).toHaveBeenCalledWith("my_server", [
        { luaName: "tool1", description: "First tool" },
        { luaName: "tool2", description: "Second tool" },
      ]);
      expect(result).toEqual({
        content: [{ type: "text", text: "Formatted tool list" }],
      });
    });

    it("should return error when server not found", async () => {
      const clientsMap = new Map<string, MCPClientSession>([
        [
          "other_server",
          createMockClientSession({}) as unknown as MCPClientSession,
        ],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listServerTools(
        "unknown_server",
        "session-123",
      );

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: expect.stringContaining("Server 'unknown_server' not found"),
          },
        ],
        isError: true,
      });
      expect(result.content[0]).toHaveProperty(
        "text",
        expect.stringContaining("Available servers: other_server"),
      );
    });

    it("should return error when no servers available", async () => {
      const clientsMap = new Map<string, MCPClientSession>();

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listServerTools(
        "unknown_server",
        "session-123",
      );

      expect(result.content[0]).toHaveProperty(
        "text",
        expect.stringContaining("Available servers: none"),
      );
    });

    it("should use default session when sessionId is empty", async () => {
      const mockClient = createMockClientSession({ tools: [] });
      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockFormatter.formatToolList.mockReturnValue("Formatted");

      await service.listServerTools("server1", "");

      expect(mockClientManager.getClientsBySession).toHaveBeenCalledWith(
        "default",
      );
    });

    it("should match server by sanitized Lua name", async () => {
      const mockTools: Tool[] = [
        {
          name: "some-tool",
          description: "A tool",
          inputSchema: { type: "object" },
        },
      ];
      const mockClient = createMockClientSession({ tools: mockTools });

      const clientsMap = new Map<string, MCPClientSession>([
        ["my-hyphenated-server", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockFormatter.formatToolList.mockReturnValue("Formatted");

      const result = await service.listServerTools(
        "my_hyphenated_server",
        "session-123",
      );

      expect(result.isError).toBeUndefined();
      expect(mockClient.listTools).toHaveBeenCalled();
    });

    it("should handle tools with no description", async () => {
      const mockTools: Tool[] = [
        { name: "tool1", inputSchema: { type: "object" } }, // no description
      ];
      const mockClient = createMockClientSession({ tools: mockTools });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockFormatter.formatToolList.mockReturnValue("Formatted");

      await service.listServerTools("server1", "session-123");

      expect(mockFormatter.formatToolList).toHaveBeenCalledWith("server1", [
        { luaName: "tool1", description: "" },
      ]);
    });

    it("should return error result when listTools throws", async () => {
      const mockClient = createMockClientSession({});
      mockClient.listTools.mockRejectedValue(new Error("Connection lost"));

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listServerTools("server1", "session-123");

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: expect.stringContaining("Failed to list tools"),
          },
        ],
        isError: true,
      });
    });
  });

  describe("getToolDetails", () => {
    it("should return formatted tool details", async () => {
      const mockTool: Tool = {
        name: "my-tool",
        description: "Tool description",
        inputSchema: { type: "object", properties: {} },
      };
      const mockClient = createMockClientSession({ tools: [mockTool] });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockFormatter.formatToolDetails.mockReturnValue("Formatted tool details");

      const result = await service.getToolDetails(
        "server1",
        "my_tool",
        "session-123",
      );

      expect(mockFormatter.formatToolDetails).toHaveBeenCalledWith(
        "server1",
        "my_tool",
        mockTool,
      );
      expect(result).toEqual({
        content: [{ type: "text", text: "Formatted tool details" }],
      });
    });

    it("should return error when server not found", async () => {
      const clientsMap = new Map<string, MCPClientSession>();

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.getToolDetails(
        "unknown_server",
        "tool1",
        "session-123",
      );

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: expect.stringContaining("Server 'unknown_server' not found"),
          },
        ],
        isError: true,
      });
    });

    it("should return error when tool not found", async () => {
      const mockTools: Tool[] = [
        {
          name: "other-tool",
          description: "Other",
          inputSchema: { type: "object" },
        },
      ];
      const mockClient = createMockClientSession({ tools: mockTools });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.getToolDetails(
        "server1",
        "unknown_tool",
        "session-123",
      );

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: expect.stringContaining("Tool 'unknown_tool' not found"),
          },
        ],
        isError: true,
      });
      expect(result.content[0]).toHaveProperty(
        "text",
        expect.stringContaining("Available tools: other_tool"),
      );
    });

    it("should match tool by sanitized Lua name", async () => {
      const mockTool: Tool = {
        name: "my-hyphenated-tool",
        description: "A tool",
        inputSchema: { type: "object" },
      };
      const mockClient = createMockClientSession({ tools: [mockTool] });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockFormatter.formatToolDetails.mockReturnValue("Formatted");

      const result = await service.getToolDetails(
        "server1",
        "my_hyphenated_tool",
        "session-123",
      );

      expect(result.isError).toBeUndefined();
      expect(mockFormatter.formatToolDetails).toHaveBeenCalled();
    });

    it("should return error when no tools available on server", async () => {
      const mockClient = createMockClientSession({ tools: [] });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.getToolDetails(
        "server1",
        "any_tool",
        "session-123",
      );

      expect(result.content[0]).toHaveProperty(
        "text",
        expect.stringContaining("Available tools: none"),
      );
    });

    it("should return error result when getToolDetails throws", async () => {
      const mockClient = createMockClientSession({});
      mockClient.listTools.mockRejectedValue(new Error("Connection error"));

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.getToolDetails(
        "server1",
        "tool1",
        "session-123",
      );

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: expect.stringContaining("Failed to get tool details"),
          },
        ],
        isError: true,
      });
    });
  });

  describe("inspectToolResponse", () => {
    it("should execute tool and return formatted response", async () => {
      const mockTool: Tool = {
        name: "test-tool",
        description: "Test tool",
        inputSchema: { type: "object" },
      };
      const mockClient = createMockClientSession({ tools: [mockTool] });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockLuaRuntime.executeScript.mockResolvedValue({ result: "success" });

      const result = await service.inspectToolResponse(
        "server1",
        "test_tool",
        { arg1: "value1" },
        "session-123",
      );

      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining("server1.test_tool"),
        clientsMap,
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0]).toHaveProperty(
        "text",
        expect.stringContaining("Tool executed"),
      );
      expect(result.content[0]).toHaveProperty(
        "text",
        expect.stringContaining('"result": "success"'),
      );
    });

    it("should return error when server not found", async () => {
      const clientsMap = new Map<string, MCPClientSession>();

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.inspectToolResponse(
        "unknown_server",
        "tool1",
        {},
        "session-123",
      );

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: expect.stringContaining("Server 'unknown_server' not found"),
          },
        ],
        isError: true,
      });
    });

    it("should return error when tool not found", async () => {
      const mockClient = createMockClientSession({ tools: [] });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.inspectToolResponse(
        "server1",
        "unknown_tool",
        {},
        "session-123",
      );

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: expect.stringContaining("Tool 'unknown_tool' not found"),
          },
        ],
        isError: true,
      });
    });

    it("should include sample args in generated Lua script", async () => {
      const mockTool: Tool = {
        name: "calc",
        description: "Calculator",
        inputSchema: { type: "object" },
      };
      const mockClient = createMockClientSession({ tools: [mockTool] });

      const clientsMap = new Map<string, MCPClientSession>([
        ["math_server", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockLuaRuntime.executeScript.mockResolvedValue(42);

      await service.inspectToolResponse(
        "math_server",
        "calc",
        { a: 10, b: 20 },
        "session-123",
      );

      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining("a = 10"),
        clientsMap,
      );
      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining("b = 20"),
        clientsMap,
      );
    });

    it("should return error with warning when execution fails", async () => {
      const mockTool: Tool = {
        name: "failing-tool",
        description: "Fails",
        inputSchema: { type: "object" },
      };
      const mockClient = createMockClientSession({ tools: [mockTool] });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockLuaRuntime.executeScript.mockRejectedValue(
        new Error("Execution failed"),
      );

      const result = await service.inspectToolResponse(
        "server1",
        "failing_tool",
        {},
        "session-123",
      );

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: expect.stringContaining("Failed to inspect tool response"),
          },
        ],
        isError: true,
      });
      expect(result.content[0]).toHaveProperty(
        "text",
        expect.stringContaining("may have been executed"),
      );
    });

    it("should log info and debug messages during execution", async () => {
      const mockTool: Tool = {
        name: "logged-tool",
        description: "Logged",
        inputSchema: { type: "object" },
      };
      const mockClient = createMockClientSession({ tools: [mockTool] });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockLuaRuntime.executeScript.mockResolvedValue({});

      await service.inspectToolResponse(
        "server1",
        "logged_tool",
        { x: 1 },
        "session-123",
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Inspecting tool response"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Generated inspection script"),
      );
    });
  });

  describe("jsonToLuaTable (via inspectToolResponse)", () => {
    let mockClient: ReturnType<typeof createMockClientSession>;
    let clientsMap: Map<string, MCPClientSession>;

    beforeEach(() => {
      const mockTool: Tool = {
        name: "test-tool",
        description: "Test",
        inputSchema: { type: "object" },
      };
      mockClient = createMockClientSession({ tools: [mockTool] });
      clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);
      mockLuaRuntime.executeScript.mockResolvedValue({});
    });

    it("should convert simple object to Lua table", async () => {
      await service.inspectToolResponse(
        "server1",
        "test_tool",
        { name: "test", value: 42 },
        "session-123",
      );

      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining('name = "test"'),
        clientsMap,
      );
      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining("value = 42"),
        clientsMap,
      );
    });

    it("should convert nested objects to Lua tables", async () => {
      await service.inspectToolResponse(
        "server1",
        "test_tool",
        { nested: { inner: "value" } },
        "session-123",
      );

      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining("nested = {"),
        clientsMap,
      );
    });

    it("should convert arrays to Lua tables", async () => {
      await service.inspectToolResponse(
        "server1",
        "test_tool",
        { items: [1, 2, 3] },
        "session-123",
      );

      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining("items = {1, 2, 3}"),
        clientsMap,
      );
    });

    it("should handle boolean values", async () => {
      await service.inspectToolResponse(
        "server1",
        "test_tool",
        { enabled: true, disabled: false },
        "session-123",
      );

      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining("enabled = true"),
        clientsMap,
      );
      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining("disabled = false"),
        clientsMap,
      );
    });

    it("should handle null values", async () => {
      await service.inspectToolResponse(
        "server1",
        "test_tool",
        { nullValue: null },
        "session-123",
      );

      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining("nullValue = null"),
        clientsMap,
      );
    });

    it("should use bracket notation for keys with special characters", async () => {
      await service.inspectToolResponse(
        "server1",
        "test_tool",
        { "special-key": "value", "123key": "numeric" },
        "session-123",
      );

      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining('["special-key"] = "value"'),
        clientsMap,
      );
      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining('["123key"] = "numeric"'),
        clientsMap,
      );
    });

    it("should handle empty objects", async () => {
      await service.inspectToolResponse(
        "server1",
        "test_tool",
        {},
        "session-123",
      );

      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining("({})"),
        clientsMap,
      );
    });

    it("should handle arrays of objects", async () => {
      await service.inspectToolResponse(
        "server1",
        "test_tool",
        { users: [{ id: 1 }, { id: 2 }] },
        "session-123",
      );

      expect(mockLuaRuntime.executeScript).toHaveBeenCalledWith(
        expect.stringContaining("users = {{id = 1}, {id = 2}}"),
        clientsMap,
      );
    });
  });
});

// Helper function to create mock client sessions
function createMockClientSession(options: {
  serverVersion?: { name?: string; version?: string; description?: string };
  instructions?: string;
  tools?: Tool[];
}): {
  getServerVersion: ReturnType<typeof vi.fn>;
  getInstructions: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
} {
  return {
    getServerVersion: vi.fn().mockReturnValue(options.serverVersion ?? {}),
    getInstructions: vi.fn().mockReturnValue(options.instructions),
    listTools: vi.fn().mockResolvedValue(options.tools ?? []),
  };
}
