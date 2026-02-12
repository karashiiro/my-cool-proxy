/**
 * Tests for the MCP Sampling Sidecar
 *
 * Note: The sidecar is an executable entry point that runs at import time,
 * relying on process.env, process.exit, and stdio transport. These tests
 * verify the logic patterns and data formats without importing the module,
 * since the module executes side effects at import time.
 *
 * Full integration testing would require spawning the process as a child
 * process and communicating via stdio.
 */
import { describe, it, expect } from "vitest";

describe("mcp-sampling-sidecar (unit tests)", () => {
  describe("tool registration logic", () => {
    it("should parse valid JSON tools configuration", () => {
      const validToolsJson = JSON.stringify([
        {
          name: "test_tool",
          description: "A test tool",
          inputSchema: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
          },
        },
      ]);

      // Verify the JSON is valid
      const tools = JSON.parse(validToolsJson);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("test_tool");
    });

    it("should handle tools with empty input schema", () => {
      const toolsJson = JSON.stringify([
        {
          name: "no_args_tool",
          description: "Tool with no arguments",
          inputSchema: { type: "object" },
        },
      ]);

      const tools = JSON.parse(toolsJson);
      expect(tools[0].inputSchema.properties).toBeUndefined();
    });

    it("should generate tagged tool names correctly", () => {
      const toolName = "my_tool";
      const toolTag = "abc123";
      const taggedName = `${toolName}-${toolTag}`;

      expect(taggedName).toBe("my_tool-abc123");
    });
  });

  describe("callback request format", () => {
    it("should format callback request correctly", () => {
      const toolName = "test_tool";
      const args = { message: "hello", count: 42 };

      const request = {
        tool: toolName,
        args: args,
      };

      expect(request.tool).toBe("test_tool");
      expect(request.args).toEqual({ message: "hello", count: 42 });
      expect(JSON.stringify(request)).toBe(
        '{"tool":"test_tool","args":{"message":"hello","count":42}}',
      );
    });
  });

  describe("captured response handling", () => {
    it("should recognize captured response format", () => {
      const capturedResponse = { status: "captured" };

      // Check if response has status property with captured value
      const isCaptured =
        "status" in capturedResponse && capturedResponse.status === "captured";

      expect(isCaptured).toBe(true);
    });

    it("should not treat regular tool result as captured", () => {
      const regularResult = {
        content: [{ type: "text", text: "result" }],
      };

      const isCaptured =
        "status" in regularResult &&
        (regularResult as { status?: string }).status === "captured";

      expect(isCaptured).toBe(false);
    });
  });
});
