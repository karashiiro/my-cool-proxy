import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolDiscoveryService } from "./tool-discovery-service.js";
import { MCPFormatterService } from "./mcp-formatter-service.js";
import type {
  IMCPClientManager,
  IMCPClientSession,
  ILogger,
  ILuaRuntime,
} from "./types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// Mock logger factory
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

// Mock client session factory
function createMockClientSession(options: {
  serverVersion?: { name?: string; version?: string; description?: string };
  instructions?: string;
  tools?: Tool[];
}): IMCPClientSession {
  return {
    getServerVersion: vi.fn().mockReturnValue(options.serverVersion ?? {}),
    getInstructions: vi.fn().mockReturnValue(options.instructions),
    listTools: vi.fn().mockResolvedValue(options.tools ?? []),
    listResources: vi.fn().mockResolvedValue([]),
    readResource: vi.fn().mockResolvedValue({ contents: [] }),
    listPrompts: vi.fn().mockResolvedValue([]),
    getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
  };
}

describe("ToolDiscoveryService", () => {
  let service: ToolDiscoveryService;
  let mockClientManager: IMCPClientManager;
  let mockLogger: ILogger;
  let mockLuaRuntime: ILuaRuntime;
  let mockFormatter: MCPFormatterService;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockFormatter = new MCPFormatterService();
    mockLuaRuntime = {
      executeScript: vi.fn().mockResolvedValue({}),
    };
    mockClientManager = {
      getClientsBySession: vi.fn().mockReturnValue(new Map()),
      getFailedServers: vi.fn().mockReturnValue(new Map()),
    };

    service = new ToolDiscoveryService(
      mockClientManager,
      mockLogger,
      mockLuaRuntime,
      mockFormatter,
    );
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

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );
      vi.mocked(mockClientManager.getFailedServers).mockReturnValue(new Map());

      const result = await service.listServers("session-123");

      expect(mockClientManager.getClientsBySession).toHaveBeenCalledWith(
        "session-123",
      );
      expect(result.content[0]?.type).toBe("text");
      expect((result.content[0] as { text: string }).text).toContain("server1");
    });

    it("should use 'default' session when sessionId is empty", async () => {
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        new Map(),
      );
      vi.mocked(mockClientManager.getFailedServers).mockReturnValue(new Map());

      await service.listServers("");

      expect(mockClientManager.getClientsBySession).toHaveBeenCalledWith(
        "default",
      );
    });

    it("should include failed servers with error status", async () => {
      const failedServersMap = new Map([
        ["failed-server", "Connection refused"],
      ]);

      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        new Map(),
      );
      vi.mocked(mockClientManager.getFailedServers).mockReturnValue(
        failedServersMap,
      );

      const result = await service.listServers("session-123");

      expect((result.content[0] as { text: string }).text).toContain(
        "failed_server",
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

      const clientsMap = new Map([["my_server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const result = await service.listServerTools("my_server", "session-123");

      expect(result.isError).toBeUndefined();
      expect((result.content[0] as { text: string }).text).toContain("tool1");
      expect((result.content[0] as { text: string }).text).toContain("tool2");
    });

    it("should return error when server not found", async () => {
      const clientsMap = new Map([
        ["other_server", createMockClientSession({})],
      ]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const result = await service.listServerTools(
        "unknown_server",
        "session-123",
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "not found",
      );
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

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const result = await service.getToolDetails(
        "server1",
        "my_tool",
        "session-123",
      );

      expect(result.isError).toBeUndefined();
      expect((result.content[0] as { text: string }).text).toContain(
        "Tool description",
      );
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

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const result = await service.getToolDetails(
        "server1",
        "unknown_tool",
        "session-123",
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "not found",
      );
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

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );
      vi.mocked(mockLuaRuntime.executeScript).mockResolvedValue({
        result: "success",
      });

      const result = await service.inspectToolResponse(
        "server1",
        "test_tool",
        { arg1: "value1" },
        "session-123",
      );

      expect(mockLuaRuntime.executeScript).toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
      expect((result.content[0] as { text: string }).text).toContain(
        "Tool executed",
      );
    });

    it("should return error when server not found", async () => {
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        new Map(),
      );

      const result = await service.inspectToolResponse(
        "unknown_server",
        "tool1",
        {},
        "session-123",
      );

      expect(result.isError).toBe(true);
    });
  });
});
