import { describe, it, expect, vi, beforeEach } from "vitest";
import { ListServersTool } from "./list-servers-tool.js";
import { ToolDiscoveryService } from "../mcp/tool-discovery-service.js";
import type {
  ILogger,
  IMCPClientManager,
  ILuaRuntime,
} from "../types/interfaces.js";
import { MCPFormatterService } from "../mcp/mcp-formatter-service.js";

// Mock logger
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

// Mock client manager
const createMockClientManager = (): IMCPClientManager => ({
  addHttpClient: vi.fn(),
  addStdioClient: vi.fn(),
  getClient: vi.fn(),
  getClientsBySession: vi.fn(() => new Map()),
  setResourceListChangedHandler: vi.fn(),
  setPromptListChangedHandler: vi.fn(),
  close: vi.fn(),
});

// Mock Lua runtime
const createMockLuaRuntime = (): ILuaRuntime => ({
  executeScript: vi.fn(async () => ({
    items: [{ id: 1, name: "test" }],
    total: 1,
  })),
});

describe("ListServersTool", () => {
  let tool: ListServersTool;
  let toolDiscovery: ToolDiscoveryService;
  let clientManager: IMCPClientManager;
  let logger: ILogger;
  let luaRuntime: ILuaRuntime;

  beforeEach(() => {
    logger = createMockLogger();
    clientManager = createMockClientManager();
    luaRuntime = createMockLuaRuntime();
    toolDiscovery = new ToolDiscoveryService(
      clientManager,
      logger,
      new MCPFormatterService(),
      luaRuntime,
    );
    tool = new ListServersTool(toolDiscovery);
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      expect(tool.name).toBe("list-servers");
    });

    it("should have comprehensive description with workflow guidance", () => {
      expect(tool.description).toContain(
        "Discover what specialized MCP servers are available",
      );
      expect(tool.description).toContain("Always call this tool FIRST");
      expect(tool.description).toContain("list-server-tools");
      expect(tool.description).toContain("tool-details");
      expect(tool.description).toContain("inspect-tool-response");
      expect(tool.description).toContain("Lua identifiers");
    });

    it("should have empty schema with no parameters", () => {
      expect(tool.schema).toEqual({});
    });
  });

  describe("execute", () => {
    it("should call toolDiscovery.listServers with correct sessionId", async () => {
      const listSpy = vi.spyOn(toolDiscovery, "listServers");
      listSpy.mockResolvedValue({
        content: [
          {
            type: "text" as const,
            text: "Available servers:\n- github\n- slack",
          },
        ],
      });

      await tool.execute({}, { sessionId: "test-session" });

      expect(listSpy).toHaveBeenCalledWith("test-session");
    });

    it("should use 'default' session when sessionId not provided", async () => {
      const listSpy = vi.spyOn(toolDiscovery, "listServers");
      listSpy.mockResolvedValue({
        content: [{ type: "text" as const, text: "Servers listed" }],
      });

      await tool.execute({}, {});

      expect(listSpy).toHaveBeenCalledWith("default");
    });

    it("should use 'default' session when sessionId is undefined", async () => {
      const listSpy = vi.spyOn(toolDiscovery, "listServers");
      listSpy.mockResolvedValue({
        content: [{ type: "text" as const, text: "Servers listed" }],
      });

      await tool.execute({}, { sessionId: undefined });

      expect(listSpy).toHaveBeenCalledWith("default");
    });

    it("should return formatted list of servers", async () => {
      const mockResponse = {
        content: [
          {
            type: "text" as const,
            text: "Available MCP Servers:\n\n1. github (GitHub API)\n2. slack (Slack Integration)",
          },
        ],
      };

      vi.spyOn(toolDiscovery, "listServers").mockResolvedValue(mockResponse);

      const result = await tool.execute({}, { sessionId: "test" });

      expect(result.content).toEqual(mockResponse.content);
    });

    it("should ignore any args passed (tool takes no parameters)", async () => {
      const listSpy = vi.spyOn(toolDiscovery, "listServers");
      listSpy.mockResolvedValue({
        content: [{ type: "text" as const, text: "Servers listed" }],
      });

      const args = {
        someRandomArg: "ignored",
        anotherArg: 123,
      };

      await tool.execute(args, { sessionId: "test" });

      expect(listSpy).toHaveBeenCalledWith("test");
    });

    it("should propagate errors from toolDiscovery", async () => {
      const errorResponse = {
        content: [
          {
            type: "text" as const,
            text: "Failed to list servers: Connection error",
          },
        ],
        isError: true,
      };

      vi.spyOn(toolDiscovery, "listServers").mockResolvedValue(errorResponse);

      const result = await tool.execute({}, { sessionId: "test" });

      expect(result.isError).toBe(true);
      expect(result.content[0]).toHaveProperty("type", "text");
    });

    it("should handle empty server list response", async () => {
      const emptyResponse = {
        content: [
          {
            type: "text" as const,
            text: "Available MCP Servers:\n\n(No servers configured)",
          },
        ],
      };

      vi.spyOn(toolDiscovery, "listServers").mockResolvedValue(emptyResponse);

      const result = await tool.execute({}, { sessionId: "test" });

      expect(result.content).toEqual(emptyResponse.content);
    });

    it("should handle server list with metadata", async () => {
      const detailedResponse = {
        content: [
          {
            type: "text" as const,
            text:
              "Available MCP Servers:\n\n" +
              "1. github (lua: github)\n" +
              "   Name: GitHub Integration\n" +
              "   Description: Access GitHub API\n" +
              "   Version: 1.0.0\n\n" +
              "2. slack (lua: slack)\n" +
              "   Name: Slack Integration\n" +
              "   Description: Send messages to Slack\n" +
              "   Version: 2.0.0",
          },
        ],
      };

      vi.spyOn(toolDiscovery, "listServers").mockResolvedValue(
        detailedResponse,
      );

      const result = await tool.execute({}, { sessionId: "test" });

      expect(result.content).toEqual(detailedResponse.content);
    });
  });
});
