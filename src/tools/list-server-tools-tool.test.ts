import { describe, it, expect, vi, beforeEach } from "vitest";
import { ListServerToolsTool } from "./list-server-tools-tool.js";
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

describe("ListServerToolsTool", () => {
  let tool: ListServerToolsTool;
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
    tool = new ListServerToolsTool(toolDiscovery);
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      expect(tool.name).toBe("list-server-tools");
    });

    it("should have comprehensive description with workflow guidance", () => {
      expect(tool.description).toContain(
        "List all tools provided by a specific MCP server",
      );
      expect(tool.description).toContain("list-servers");
      expect(tool.description).toContain("tool-details");
      expect(tool.description).toContain(
        "identify which tools might be relevant",
      );
    });

    it("should have schema with required luaServerName parameter", () => {
      expect(tool.schema).toHaveProperty("luaServerName");
      expect(tool.schema.luaServerName).toBeDefined();
    });
  });

  describe("execute", () => {
    it("should call toolDiscovery.listServerTools with correct arguments", async () => {
      const listSpy = vi.spyOn(toolDiscovery, "listServerTools");
      listSpy.mockResolvedValue({
        content: [
          {
            type: "text",
            text: "Tools for github:\n- search_issues\n- create_issue",
          },
        ],
      });

      const args = {
        luaServerName: "github",
      };

      await tool.execute(args, { sessionId: "test-session" });

      expect(listSpy).toHaveBeenCalledWith("github", "test-session");
    });

    it("should use 'default' session when sessionId not provided", async () => {
      const listSpy = vi.spyOn(toolDiscovery, "listServerTools");
      listSpy.mockResolvedValue({
        content: [{ type: "text", text: "Tools listed" }],
      });

      const args = {
        luaServerName: "my_server",
      };

      await tool.execute(args, {});

      expect(listSpy).toHaveBeenCalledWith("my_server", "default");
    });

    it("should use 'default' session when sessionId is undefined", async () => {
      const listSpy = vi.spyOn(toolDiscovery, "listServerTools");
      listSpy.mockResolvedValue({
        content: [{ type: "text", text: "Tools listed" }],
      });

      const args = {
        luaServerName: "example_server",
      };

      await tool.execute(args, { sessionId: undefined });

      expect(listSpy).toHaveBeenCalledWith("example_server", "default");
    });

    it("should return formatted list of tools", async () => {
      const mockResponse = {
        content: [
          {
            type: "text" as const,
            text: "Tools available on github:\n- search_issues: Search GitHub issues\n- create_pr: Create a pull request",
          },
        ],
      };

      vi.spyOn(toolDiscovery, "listServerTools").mockResolvedValue(
        mockResponse,
      );

      const args = {
        luaServerName: "github",
      };

      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.content).toEqual(mockResponse.content);
    });

    it("should propagate error when server not found", async () => {
      const errorResponse = {
        content: [
          {
            type: "text" as const,
            text: "Server 'invalid_server' not found in session 'test'.\n\nAvailable servers: github, slack",
          },
        ],
        isError: true,
      };

      vi.spyOn(toolDiscovery, "listServerTools").mockResolvedValue(
        errorResponse,
      );

      const args = {
        luaServerName: "invalid_server",
      };

      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.isError).toBe(true);
      expect(result.content[0]).toHaveProperty("type", "text");
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("not found");
      }
    });

    it("should propagate general errors from toolDiscovery", async () => {
      const errorResponse = {
        content: [
          {
            type: "text" as const,
            text: "Failed to list tools for server 'github': Connection timeout",
          },
        ],
        isError: true,
      };

      vi.spyOn(toolDiscovery, "listServerTools").mockResolvedValue(
        errorResponse,
      );

      const args = {
        luaServerName: "github",
      };

      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.isError).toBe(true);
    });

    it("should handle empty tool list response", async () => {
      const emptyResponse = {
        content: [
          {
            type: "text" as const,
            text: "Tools available on empty_server:\n\n(No tools available)",
          },
        ],
      };

      vi.spyOn(toolDiscovery, "listServerTools").mockResolvedValue(
        emptyResponse,
      );

      const args = {
        luaServerName: "empty_server",
      };

      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.content).toEqual(emptyResponse.content);
    });

    it("should type-cast luaServerName as string", async () => {
      const listSpy = vi.spyOn(toolDiscovery, "listServerTools");
      listSpy.mockResolvedValue({
        content: [{ type: "text", text: "Tools listed" }],
      });

      const args = {
        luaServerName: "test_server",
        extraParam: "ignored",
      };

      await tool.execute(args, { sessionId: "test" });

      expect(listSpy).toHaveBeenCalledWith("test_server", "test");
    });
  });
});
