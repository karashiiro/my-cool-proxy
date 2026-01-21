import { describe, it, expect, beforeEach } from "vitest";
import { TestBed } from "@suites/unit";
import { InspectToolResponseTool } from "./inspect-tool-response-tool.js";
import { TYPES } from "../types/index.js";

describe("InspectToolResponseTool", () => {
  let tool: InspectToolResponseTool;
  let toolDiscovery: ReturnType<typeof unitRef.get>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let unitRef: any;

  beforeEach(async () => {
    const { unit, unitRef: ref } = await TestBed.solitary(
      InspectToolResponseTool,
    ).compile();
    tool = unit;
    unitRef = ref;
    toolDiscovery = unitRef.get(TYPES.ToolDiscoveryService);
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      expect(tool.name).toBe("inspect-tool-response");
    });

    it("should have comprehensive description with warnings", () => {
      expect(tool.description).toContain("⚠️ WARNING");
      expect(tool.description).toContain("ACTUALLY EXECUTES");
      expect(tool.description).toContain("WHEN TO USE");
      expect(tool.description).toContain("WHEN NOT TO USE");
      expect(tool.description).toContain("side effects");
    });

    it("should have schema with required parameters", () => {
      expect(tool.schema).toHaveProperty("luaServerName");
      expect(tool.schema).toHaveProperty("luaToolName");
      expect(tool.schema).toHaveProperty("sampleArgs");
    });
  });

  describe("execute", () => {
    it("should call toolDiscovery.inspectToolResponse with correct arguments", async () => {
      const inspectSpy = toolDiscovery.inspectToolResponse;
      inspectSpy.mockResolvedValue({
        content: [{ type: "text", text: "Sample response" }],
      });

      const args = {
        luaServerName: "github",
        luaToolName: "search_issues",
        sampleArgs: { query: "test", limit: 1 },
      };

      await tool.execute(args, { sessionId: "test-session" });

      expect(inspectSpy).toHaveBeenCalledWith(
        "github",
        "search_issues",
        { query: "test", limit: 1 },
        "test-session",
      );
    });

    it("should use 'default' session when sessionId not provided", async () => {
      const inspectSpy = toolDiscovery.inspectToolResponse;
      inspectSpy.mockResolvedValue({
        content: [{ type: "text", text: "Sample response" }],
      });

      const args = {
        luaServerName: "github",
        luaToolName: "search_issues",
      };

      await tool.execute(args, {});

      expect(inspectSpy).toHaveBeenCalledWith(
        "github",
        "search_issues",
        {},
        "default",
      );
    });

    it("should handle undefined sampleArgs", async () => {
      const inspectSpy = toolDiscovery.inspectToolResponse;
      inspectSpy.mockResolvedValue({
        content: [{ type: "text", text: "Sample response" }],
      });

      const args = {
        luaServerName: "github",
        luaToolName: "search_issues",
        sampleArgs: undefined,
      };

      await tool.execute(args, { sessionId: "test" });

      expect(inspectSpy).toHaveBeenCalledWith(
        "github",
        "search_issues",
        {},
        "test",
      );
    });

    it("should return formatted response with structure info", async () => {
      const mockResponse = {
        content: [
          {
            type: "text" as const,
            text: "⚠️ Tool executed: github.search_issues\n\nSample Response Structure:\n...",
          },
        ],
      };

      toolDiscovery.inspectToolResponse.mockResolvedValue(mockResponse);

      const args = {
        luaServerName: "github",
        luaToolName: "search_issues",
        sampleArgs: { query: "test" },
      };

      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.content).toEqual(mockResponse.content);
    });

    it("should propagate errors from toolDiscovery", async () => {
      toolDiscovery.inspectToolResponse.mockResolvedValue({
        content: [{ type: "text", text: "Failed to inspect" }],
        isError: true,
      });

      const args = {
        luaServerName: "invalid",
        luaToolName: "nonexistent",
      };

      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.isError).toBe(true);
    });
  });
});
