import { describe, it, expect, beforeEach } from "vitest";
import { TestBed } from "@suites/unit";
import { ExecuteLuaTool } from "./execute-lua-tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TYPES } from "../types/index.js";

describe("ExecuteLuaTool", () => {
  let tool: ExecuteLuaTool;
  let luaRuntime: ReturnType<typeof unitRef.get>;
  let clientManager: ReturnType<typeof unitRef.get>;
  let logger: ReturnType<typeof unitRef.get>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let unitRef: any;

  beforeEach(async () => {
    const { unit, unitRef: ref } =
      await TestBed.solitary(ExecuteLuaTool).compile();
    tool = unit;
    unitRef = ref;
    luaRuntime = unitRef.get(TYPES.LuaRuntime);
    clientManager = unitRef.get(TYPES.MCPClientManager);
    logger = unitRef.get(TYPES.Logger);
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      expect(tool.name).toBe("execute");
    });

    it("should have comprehensive description with workflow guidance", () => {
      expect(tool.description).toContain("Execute a Lua script");
      expect(tool.description).toContain("WORKFLOW");
      expect(tool.description).toContain("list-servers");
      expect(tool.description).toContain("list-server-tools");
      expect(tool.description).toContain("tool-details");
      expect(tool.description).toContain("SCRIPT SYNTAX");
      expect(tool.description).toContain(":await()");
      expect(tool.description).toContain("result()");
      expect(tool.description).toContain("OPTIMIZATION");
    });

    it("should have schema with required script parameter", () => {
      expect(tool.schema).toHaveProperty("script");
    });
  });

  describe("execute", () => {
    it("should call luaRuntime.executeScript with script and mcpServers", async () => {
      const mockServers = new Map();
      clientManager.getClientsBySession.mockReturnValue(mockServers);
      luaRuntime.executeScript.mockResolvedValue({
        result: "success",
      });

      const args = {
        script: 'result(server.tool({arg = "value"}):await())',
      };

      await tool.execute(args, { sessionId: "test-session" });

      expect(luaRuntime.executeScript).toHaveBeenCalledWith(
        'result(server.tool({arg = "value"}):await())',
        mockServers,
      );
    });

    it("should use 'default' session when sessionId not provided", async () => {
      const mockServers = new Map();
      clientManager.getClientsBySession.mockReturnValue(mockServers);
      luaRuntime.executeScript.mockResolvedValue({});

      await tool.execute({ script: "result({})" }, {});

      expect(clientManager.getClientsBySession).toHaveBeenCalledWith("default");
    });

    it("should use 'default' session when sessionId is undefined", async () => {
      const mockServers = new Map();
      clientManager.getClientsBySession.mockReturnValue(mockServers);
      luaRuntime.executeScript.mockResolvedValue({});

      await tool.execute({ script: "result({})" }, { sessionId: undefined });

      expect(clientManager.getClientsBySession).toHaveBeenCalledWith("default");
    });

    it("should return CallToolResult as-is when script returns valid CallToolResult", async () => {
      const callToolResult: CallToolResult = {
        content: [
          {
            type: "text" as const,
            text: "Custom result from Lua",
          },
        ],
        isError: false,
      };

      luaRuntime.executeScript.mockResolvedValue(callToolResult);

      const result = await tool.execute(
        { script: "result({content = ...})" },
        { sessionId: "test" },
      );

      expect(result).toEqual(callToolResult);
    });

    it("should return structured content for object results", async () => {
      const objectResult = {
        items: [
          { id: 1, name: "Item 1" },
          { id: 2, name: "Item 2" },
        ],
        total: 2,
      };

      luaRuntime.executeScript.mockResolvedValue(objectResult);

      const result = await tool.execute(
        { script: "result({items = ..., total = 2})" },
        { sessionId: "test" },
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain(
          JSON.stringify(objectResult, null, 2),
        );
      }
      expect(result.structuredContent).toEqual(objectResult);
    });

    it("should return text result for string values", async () => {
      luaRuntime.executeScript.mockResolvedValue("Simple string result");

      const result = await tool.execute(
        { script: 'result("Simple string result")' },
        { sessionId: "test" },
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("Simple string result");
      }
    });

    it("should return text result for number values", async () => {
      luaRuntime.executeScript.mockResolvedValue(42);

      const result = await tool.execute(
        { script: "result(42)" },
        { sessionId: "test" },
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("42");
      }
    });

    it("should handle undefined result", async () => {
      luaRuntime.executeScript.mockResolvedValue(undefined);

      const result = await tool.execute(
        { script: "-- no result call" },
        { sessionId: "test" },
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("No result returned");
      }
    });

    it("should handle null result as object", async () => {
      luaRuntime.executeScript.mockResolvedValue(null);

      const result = await tool.execute(
        { script: "result(null)" },
        { sessionId: "test" },
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");
      // null is treated as a non-object primitive in the code
    });

    it("should handle script execution errors", async () => {
      const error = new Error("Lua syntax error on line 3");
      luaRuntime.executeScript.mockRejectedValue(error);

      const result = await tool.execute(
        { script: "invalid lua code {{" },
        { sessionId: "test" },
      );

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("Script execution failed");
        expect(result.content[0].text).toContain("Lua syntax error");
      }
      expect(logger.error).toHaveBeenCalled();
    });

    it("should handle runtime errors during tool calls", async () => {
      const error = new Error("Tool 'nonexistent' not found");
      luaRuntime.executeScript.mockRejectedValue(error);

      const result = await tool.execute(
        { script: "result(server.nonexistent():await())" },
        { sessionId: "test" },
      );

      expect(result.isError).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Lua script execution failed"),
      );
    });

    it("should type-cast script parameter as string", async () => {
      const mockServers = new Map();
      clientManager.getClientsBySession.mockReturnValue(mockServers);
      luaRuntime.executeScript.mockResolvedValue({});

      const args = {
        script: "result({})",
        extraParam: "ignored",
      };

      await tool.execute(args, { sessionId: "test" });

      expect(luaRuntime.executeScript).toHaveBeenCalledWith(
        "result({})",
        expect.any(Map),
      );
    });

    it("should handle array results as objects", async () => {
      const arrayResult = [1, 2, 3, 4, 5];
      luaRuntime.executeScript.mockResolvedValue(arrayResult);

      const result = await tool.execute(
        { script: "result({1, 2, 3, 4, 5})" },
        { sessionId: "test" },
      );

      expect(result.content).toHaveLength(1);
      expect(result.structuredContent).toEqual(arrayResult);
    });

    it("should handle complex nested object results", async () => {
      const complexResult = {
        user: {
          id: 123,
          name: "Test User",
          metadata: {
            tags: ["tag1", "tag2"],
            scores: [95, 87, 92],
          },
        },
        success: true,
      };

      luaRuntime.executeScript.mockResolvedValue(complexResult);

      const result = await tool.execute(
        { script: "result(complex_object)" },
        { sessionId: "test" },
      );

      expect(result.structuredContent).toEqual(complexResult);
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("Test User");
        expect(result.content[0].text).toContain("tag1");
      }
    });

    it("should handle boolean results", async () => {
      luaRuntime.executeScript.mockResolvedValue(true);

      const result = await tool.execute(
        { script: "result(true)" },
        { sessionId: "test" },
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("true");
      }
    });

    it("should reject invalid CallToolResult-like objects", async () => {
      const invalidResult = {
        content: "not an array", // Should be array but isn't
      };

      luaRuntime.executeScript.mockResolvedValue(invalidResult);

      const result = await tool.execute(
        { script: "result({content = ...})" },
        { sessionId: "test" },
      );

      // Should fall through to object handling since it fails CallToolResult validation
      expect(result.structuredContent).toEqual(invalidResult);
    });
  });
});
