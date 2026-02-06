import { describe, it, expect, beforeEach } from "vitest";
import { TestBed } from "@suites/unit";
import { ReadResourceTool } from "./read-resource-tool.js";
import { TYPES } from "../types/index.js";

describe("ReadResourceTool", () => {
  let tool: ReadResourceTool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let unitRef: any;
  let resourceAggregation: ReturnType<typeof unitRef.get>;

  beforeEach(async () => {
    const { unit, unitRef: ref } =
      await TestBed.solitary(ReadResourceTool).compile();
    tool = unit;
    unitRef = ref;
    resourceAggregation = unitRef.get(TYPES.ResourceAggregationService);
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      expect(tool.name).toBe("read-resource");
    });

    it("should have description mentioning resource reading", () => {
      expect(tool.description).toContain("resource");
      expect(tool.description).toContain("URI");
    });

    it("should have schema with uri parameter", () => {
      expect(tool.schema).toHaveProperty("uri");
    });
  });

  describe("execute", () => {
    it("should return formatted text content with URI and MIME type", async () => {
      resourceAggregation.readResource.mockResolvedValue({
        contents: [
          {
            uri: "mcp://docs/file:///README.md",
            mimeType: "text/markdown",
            text: "# Hello World\n\nThis is the readme.",
          },
        ],
      });

      const result = await tool.execute(
        { uri: "mcp://docs/file:///README.md" },
        { sessionId: "test-session" },
      );

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("[mcp://docs/file:///README.md]");
      expect(text).toContain("(text/markdown)");
      expect(text).toContain("# Hello World");
      expect(text).toContain("This is the readme.");
    });

    it("should handle blob content with size note", async () => {
      // A base64 string "SGVsbG8=" decodes to "Hello" (5 bytes)
      // The string length is 8, so (8 * 3) / 4 = 6 bytes approx
      resourceAggregation.readResource.mockResolvedValue({
        contents: [
          {
            uri: "mcp://files/file:///image.png",
            mimeType: "image/png",
            blob: "SGVsbG8=",
          },
        ],
      });

      const result = await tool.execute(
        { uri: "mcp://files/file:///image.png" },
        { sessionId: "test" },
      );

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("[mcp://files/file:///image.png]");
      expect(text).toContain("(image/png)");
      expect(text).toContain("Binary content");
      expect(text).toContain("Base64 data omitted");
      // Should NOT contain the raw base64
      expect(text).not.toContain("SGVsbG8=");
    });

    it("should return error for missing uri parameter", async () => {
      const result = await tool.execute({}, { sessionId: "test" });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Missing required parameter: uri");
    });

    it("should return error when ResourceAggregationService throws for invalid URI format", async () => {
      resourceAggregation.readResource.mockRejectedValue(
        new Error(
          "Invalid resource URI format: 'bad-uri'. Expected format: mcp://{server-name}/{uri}",
        ),
      );

      const result = await tool.execute(
        { uri: "bad-uri" },
        { sessionId: "test" },
      );

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Invalid resource URI format");
    });

    it("should return error when server not found", async () => {
      resourceAggregation.readResource.mockRejectedValue(
        new Error(
          "Server 'nonexistent' not found in session 'test'. Available servers: docs, wiki",
        ),
      );

      const result = await tool.execute(
        { uri: "mcp://nonexistent/file:///foo" },
        { sessionId: "test" },
      );

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Server 'nonexistent' not found");
    });

    it("should return error when upstream read fails", async () => {
      resourceAggregation.readResource.mockRejectedValue(
        new Error("Connection refused"),
      );

      const result = await tool.execute(
        { uri: "mcp://docs/file:///missing.md" },
        { sessionId: "test" },
      );

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Failed to read resource");
      expect(text).toContain("Connection refused");
    });

    it("should use 'default' session when sessionId not provided", async () => {
      resourceAggregation.readResource.mockResolvedValue({
        contents: [
          {
            uri: "mcp://docs/file:///test.txt",
            text: "content",
          },
        ],
      });

      await tool.execute({ uri: "mcp://docs/file:///test.txt" }, {});

      expect(resourceAggregation.readResource).toHaveBeenCalledWith(
        "mcp://docs/file:///test.txt",
        "default",
      );
    });

    it("should handle multiple content blocks in response", async () => {
      resourceAggregation.readResource.mockResolvedValue({
        contents: [
          {
            uri: "mcp://docs/file:///part1.txt",
            mimeType: "text/plain",
            text: "Part 1 content",
          },
          {
            uri: "mcp://docs/file:///part2.txt",
            mimeType: "text/plain",
            text: "Part 2 content",
          },
        ],
      });

      const result = await tool.execute(
        { uri: "mcp://docs/file:///multi" },
        { sessionId: "test" },
      );

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Part 1 content");
      expect(text).toContain("Part 2 content");
      expect(text).toContain("[mcp://docs/file:///part1.txt]");
      expect(text).toContain("[mcp://docs/file:///part2.txt]");
    });

    it("should return informational message for empty contents", async () => {
      resourceAggregation.readResource.mockResolvedValue({
        contents: [],
      });

      const result = await tool.execute(
        { uri: "mcp://docs/file:///empty" },
        { sessionId: "test" },
      );

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("returned no content");
    });

    it("should handle content without mimeType field", async () => {
      resourceAggregation.readResource.mockResolvedValue({
        contents: [
          {
            uri: "mcp://api/data://users",
            text: '{"users": []}',
          },
        ],
      });

      const result = await tool.execute(
        { uri: "mcp://api/data://users" },
        { sessionId: "test" },
      );

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: "text"; text: string }).text;
      // Should show URI without MIME type parenthetical
      expect(text).toContain("[mcp://api/data://users]");
      expect(text).not.toMatch(/\(.*\)/);
      expect(text).toContain('{"users": []}');
    });
  });
});
