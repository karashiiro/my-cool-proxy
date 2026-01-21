import { describe, it, expect, beforeEach } from "vitest";
import { TestBed } from "@suites/unit";
import { ListServerToolsTool } from "./list-server-tools-tool.js";
import { TYPES } from "../types/index.js";

describe("ListServerToolsTool", () => {
  let tool: ListServerToolsTool;
  let toolDiscovery: ReturnType<typeof unitRef.get>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let unitRef: any;

  beforeEach(async () => {
    const { unit, unitRef: ref } =
      await TestBed.solitary(ListServerToolsTool).compile();
    tool = unit;
    unitRef = ref;
    toolDiscovery = unitRef.get(TYPES.ToolDiscoveryService);
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
      toolDiscovery.listServerTools.mockResolvedValue({
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

      expect(toolDiscovery.listServerTools).toHaveBeenCalledWith(
        "github",
        "test-session",
      );
    });

    it("should use 'default' session when sessionId not provided", async () => {
      toolDiscovery.listServerTools.mockResolvedValue({
        content: [{ type: "text", text: "Tools listed" }],
      });

      const args = {
        luaServerName: "my_server",
      };

      await tool.execute(args, {});

      expect(toolDiscovery.listServerTools).toHaveBeenCalledWith(
        "my_server",
        "default",
      );
    });

    it("should use 'default' session when sessionId is undefined", async () => {
      toolDiscovery.listServerTools.mockResolvedValue({
        content: [{ type: "text", text: "Tools listed" }],
      });

      const args = {
        luaServerName: "example_server",
      };

      await tool.execute(args, { sessionId: undefined });

      expect(toolDiscovery.listServerTools).toHaveBeenCalledWith(
        "example_server",
        "default",
      );
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

      toolDiscovery.listServerTools.mockResolvedValue(mockResponse);

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

      toolDiscovery.listServerTools.mockResolvedValue(errorResponse);

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

      toolDiscovery.listServerTools.mockResolvedValue(errorResponse);

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

      toolDiscovery.listServerTools.mockResolvedValue(emptyResponse);

      const args = {
        luaServerName: "empty_server",
      };

      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.content).toEqual(emptyResponse.content);
    });

    it("should type-cast luaServerName as string", async () => {
      toolDiscovery.listServerTools.mockResolvedValue({
        content: [{ type: "text", text: "Tools listed" }],
      });

      const args = {
        luaServerName: "test_server",
        extraParam: "ignored",
      };

      await tool.execute(args, { sessionId: "test" });

      expect(toolDiscovery.listServerTools).toHaveBeenCalledWith(
        "test_server",
        "test",
      );
    });
  });
});
