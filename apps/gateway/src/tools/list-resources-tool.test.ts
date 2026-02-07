import { describe, it, expect, beforeEach } from "vitest";
import { TestBed } from "@suites/unit";
import { ListResourcesTool } from "./list-resources-tool.js";
import { TYPES } from "../types/index.js";

describe("ListResourcesTool", () => {
  let tool: ListResourcesTool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let unitRef: any;
  let resourceAggregation: ReturnType<typeof unitRef.get>;

  beforeEach(async () => {
    const { unit, unitRef: ref } =
      await TestBed.solitary(ListResourcesTool).compile();
    tool = unit;
    unitRef = ref;
    resourceAggregation = unitRef.get(TYPES.ResourceAggregationService);
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      expect(tool.name).toBe("list-resources");
    });

    it("should have description mentioning resources and servers", () => {
      expect(tool.description).toContain("resources");
      expect(tool.description).toContain("MCP server");
    });

    it("should have empty schema with no parameters", () => {
      expect(tool.schema).toEqual({});
    });
  });

  describe("execute", () => {
    it("should return formatted listing grouped by server", async () => {
      resourceAggregation.listResources.mockResolvedValue({
        resources: [
          {
            name: "README",
            uri: "gw://docs-server/file:///README.md",
            description: "Project readme",
            mimeType: "text/markdown",
          },
          {
            name: "Config",
            uri: "gw://docs-server/file:///config.json",
            mimeType: "application/json",
          },
          {
            name: "User Guide",
            uri: "gw://wiki/page://getting-started",
            description: "Getting started guide",
          },
        ],
      });

      const result = await tool.execute({}, { sessionId: "test-session" });

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: "text"; text: string }).text;

      // Header
      expect(text).toContain("Available Resources (3 total across 2 servers)");

      // docs-server group
      expect(text).toContain("## docs-server (2 resources)");
      expect(text).toContain("**README**");
      expect(text).toContain("URI: gw://docs-server/file:///README.md");
      expect(text).toContain("Description: Project readme");
      expect(text).toContain("MIME type: text/markdown");
      expect(text).toContain("**Config**");
      expect(text).toContain("MIME type: application/json");

      // wiki group
      expect(text).toContain("## wiki (1 resource)");
      expect(text).toContain("**User Guide**");
      expect(text).toContain("Description: Getting started guide");
    });

    it("should return informational message when no resources available", async () => {
      resourceAggregation.listResources.mockResolvedValue({
        resources: [],
      });

      const result = await tool.execute({}, { sessionId: "test-session" });

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("No resources are currently available");
    });

    it("should use 'default' session when sessionId not provided", async () => {
      resourceAggregation.listResources.mockResolvedValue({
        resources: [],
      });

      await tool.execute({}, {});

      expect(resourceAggregation.listResources).toHaveBeenCalledWith("default");
    });

    it("should omit description when not present on resource", async () => {
      resourceAggregation.listResources.mockResolvedValue({
        resources: [
          {
            name: "Data",
            uri: "gw://api/data://users",
          },
        ],
      });

      const result = await tool.execute({}, { sessionId: "test" });

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("**Data**");
      expect(text).toContain("URI: gw://api/data://users");
      expect(text).not.toContain("Description:");
    });

    it("should omit MIME type when not present on resource", async () => {
      resourceAggregation.listResources.mockResolvedValue({
        resources: [
          {
            name: "Data",
            uri: "gw://api/data://users",
          },
        ],
      });

      const result = await tool.execute({}, { sessionId: "test" });

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).not.toContain("MIME type:");
    });

    it("should handle single server with singular grammar", async () => {
      resourceAggregation.listResources.mockResolvedValue({
        resources: [
          {
            name: "Solo",
            uri: "gw://only-server/res://1",
          },
        ],
      });

      const result = await tool.execute({}, { sessionId: "test" });

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("1 total across 1 server)");
      expect(text).toContain("## only-server (1 resource)");
    });

    it("should ignore any args passed (tool takes no parameters)", async () => {
      resourceAggregation.listResources.mockResolvedValue({
        resources: [],
      });

      const args = { someRandomArg: "ignored", anotherArg: 123 };
      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.isError).toBeUndefined();
    });
  });
});
