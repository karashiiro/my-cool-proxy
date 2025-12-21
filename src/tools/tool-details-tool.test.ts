import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolDetailsTool } from "./tool-details-tool.js";
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

describe("ToolDetailsTool", () => {
  let tool: ToolDetailsTool;
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
    tool = new ToolDetailsTool(toolDiscovery);
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      expect(tool.name).toBe("tool-details");
    });

    it("should have comprehensive description with workflow guidance", () => {
      expect(tool.description).toContain(
        "Get comprehensive information about a specific tool",
      );
      expect(tool.description).toContain("You MUST call this");
      expect(tool.description).toContain("list-server-tools");
      expect(tool.description).toContain("inspect-tool-response");
      expect(tool.description).toContain("input schema");
      expect(tool.description).toContain("required/optional parameters");
    });

    it("should have schema with required parameters", () => {
      expect(tool.schema).toHaveProperty("luaServerName");
      expect(tool.schema).toHaveProperty("luaToolName");
    });
  });

  describe("execute", () => {
    it("should call toolDiscovery.getToolDetails with correct arguments", async () => {
      const detailsSpy = vi.spyOn(toolDiscovery, "getToolDetails");
      detailsSpy.mockResolvedValue({
        content: [
          {
            type: "text" as const,
            text: "Tool: search_issues\nDescription: Search GitHub issues",
          },
        ],
      });

      const args = {
        luaServerName: "github",
        luaToolName: "search_issues",
      };

      await tool.execute(args, { sessionId: "test-session" });

      expect(detailsSpy).toHaveBeenCalledWith(
        "github",
        "search_issues",
        "test-session",
      );
    });

    it("should use 'default' session when sessionId not provided", async () => {
      const detailsSpy = vi.spyOn(toolDiscovery, "getToolDetails");
      detailsSpy.mockResolvedValue({
        content: [{ type: "text" as const, text: "Tool details" }],
      });

      const args = {
        luaServerName: "my_server",
        luaToolName: "my_tool",
      };

      await tool.execute(args, {});

      expect(detailsSpy).toHaveBeenCalledWith(
        "my_server",
        "my_tool",
        "default",
      );
    });

    it("should use 'default' session when sessionId is undefined", async () => {
      const detailsSpy = vi.spyOn(toolDiscovery, "getToolDetails");
      detailsSpy.mockResolvedValue({
        content: [{ type: "text" as const, text: "Tool details" }],
      });

      const args = {
        luaServerName: "example_server",
        luaToolName: "example_tool",
      };

      await tool.execute(args, { sessionId: undefined });

      expect(detailsSpy).toHaveBeenCalledWith(
        "example_server",
        "example_tool",
        "default",
      );
    });

    it("should return formatted tool details with schema", async () => {
      const mockResponse = {
        content: [
          {
            type: "text" as const,
            text:
              "Tool: github.search_issues\n\n" +
              "Description: Search for GitHub issues\n\n" +
              "Parameters:\n" +
              "  - query (required): Search query string\n" +
              "  - limit (optional): Max number of results\n\n" +
              "Example usage:\n" +
              '  github.search_issues({query = "bug", limit = 10})',
          },
        ],
      };

      vi.spyOn(toolDiscovery, "getToolDetails").mockResolvedValue(mockResponse);

      const args = {
        luaServerName: "github",
        luaToolName: "search_issues",
      };

      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.content).toEqual(mockResponse.content);
    });

    it("should propagate error when server not found", async () => {
      const errorResponse = {
        content: [
          {
            type: "text" as const,
            text: "Server 'invalid_server' not found.\n\nAvailable servers: github, slack",
          },
        ],
        isError: true,
      };

      vi.spyOn(toolDiscovery, "getToolDetails").mockResolvedValue(
        errorResponse,
      );

      const args = {
        luaServerName: "invalid_server",
        luaToolName: "some_tool",
      };

      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.isError).toBe(true);
      expect(result.content[0]).toHaveProperty("type", "text");
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("not found");
      }
    });

    it("should propagate error when tool not found on server", async () => {
      const errorResponse = {
        content: [
          {
            type: "text" as const,
            text: "Tool 'nonexistent_tool' not found on server 'github'.\n\nAvailable tools: search_issues, create_pr",
          },
        ],
        isError: true,
      };

      vi.spyOn(toolDiscovery, "getToolDetails").mockResolvedValue(
        errorResponse,
      );

      const args = {
        luaServerName: "github",
        luaToolName: "nonexistent_tool",
      };

      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.isError).toBe(true);
      expect(result.content[0]).toHaveProperty("type", "text");
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("not found");
        expect(result.content[0].text).toContain("Available tools");
      }
    });

    it("should propagate general errors from toolDiscovery", async () => {
      const errorResponse = {
        content: [
          {
            type: "text" as const,
            text: "Failed to get tool details: Network timeout",
          },
        ],
        isError: true,
      };

      vi.spyOn(toolDiscovery, "getToolDetails").mockResolvedValue(
        errorResponse,
      );

      const args = {
        luaServerName: "github",
        luaToolName: "search_issues",
      };

      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.isError).toBe(true);
    });

    it("should handle tools with complex schema definitions", async () => {
      const complexSchemaResponse = {
        content: [
          {
            type: "text" as const,
            text:
              "Tool: api.create_resource\n\n" +
              "Description: Create a new resource with nested properties\n\n" +
              "Parameters:\n" +
              "  - name (required, string): Resource name\n" +
              "  - metadata (optional, object):\n" +
              "    - tags (array): List of tags\n" +
              "    - priority (number): Priority level\n" +
              "  - config (required, object):\n" +
              "    - enabled (boolean): Enable the resource\n" +
              "    - settings (object): Additional settings",
          },
        ],
      };

      vi.spyOn(toolDiscovery, "getToolDetails").mockResolvedValue(
        complexSchemaResponse,
      );

      const args = {
        luaServerName: "api",
        luaToolName: "create_resource",
      };

      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.content).toEqual(complexSchemaResponse.content);
    });

    it("should type-cast both parameters as strings", async () => {
      const detailsSpy = vi.spyOn(toolDiscovery, "getToolDetails");
      detailsSpy.mockResolvedValue({
        content: [{ type: "text" as const, text: "Tool details" }],
      });

      const args = {
        luaServerName: "test_server",
        luaToolName: "test_tool",
        extraParam: "ignored",
      };

      await tool.execute(args, { sessionId: "test" });

      expect(detailsSpy).toHaveBeenCalledWith(
        "test_server",
        "test_tool",
        "test",
      );
    });
  });
});
