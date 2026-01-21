import { describe, it, expect, beforeEach } from "vitest";
import { TestBed } from "@suites/unit";
import { SummaryStatsTool } from "./summary-stats-tool.js";
import { TYPES } from "../types/index.js";

describe("SummaryStatsTool", () => {
  let tool: SummaryStatsTool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let unitRef: any;
  let clientPool: ReturnType<typeof unitRef.get>;
  let resourceAggregation: ReturnType<typeof unitRef.get>;
  let promptAggregation: ReturnType<typeof unitRef.get>;

  beforeEach(async () => {
    const { unit, unitRef: ref } =
      await TestBed.solitary(SummaryStatsTool).compile();
    tool = unit;
    unitRef = ref;
    clientPool = unitRef.get(TYPES.MCPClientManager);
    resourceAggregation = unitRef.get(TYPES.ResourceAggregationService);
    promptAggregation = unitRef.get(TYPES.PromptAggregationService);
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      expect(tool.name).toBe("summary");
    });

    it("should have description mentioning counts", () => {
      expect(tool.description).toContain("summary");
      expect(tool.description).toContain("servers");
      expect(tool.description).toContain("tools");
      expect(tool.description).toContain("resources");
      expect(tool.description).toContain("prompts");
    });

    it("should have empty schema with no parameters", () => {
      expect(tool.schema).toEqual({});
    });
  });

  describe("execute", () => {
    it("should return formatted summary with all counts", async () => {
      const mockClient1 = {
        listTools: async () => [{ name: "tool1" }, { name: "tool2" }],
      };
      const mockClient2 = { listTools: async () => [{ name: "tool3" }] };

      clientPool.getClientsBySession.mockReturnValue(
        new Map([
          ["server1", mockClient1],
          ["server2", mockClient2],
        ]),
      );
      clientPool.getFailedServers.mockReturnValue(new Map());

      resourceAggregation.listResources.mockResolvedValue({
        resources: [{ uri: "r1" }, { uri: "r2" }, { uri: "r3" }, { uri: "r4" }],
      });

      promptAggregation.listPrompts.mockResolvedValue({
        prompts: [{ name: "p1" }, { name: "p2" }],
      });

      const result = await tool.execute({}, { sessionId: "test-session" });

      expect(result.content[0]!.type).toBe("text");
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Gateway Summary");
      expect(text).toContain("Servers: 2 connected");
      expect(text).toContain("Tools: 3");
      expect(text).toContain("Resources: 4");
      expect(text).toContain("Prompts: 2");
    });

    it("should use 'default' session when sessionId not provided", async () => {
      clientPool.getClientsBySession.mockReturnValue(new Map());
      clientPool.getFailedServers.mockReturnValue(new Map());
      resourceAggregation.listResources.mockResolvedValue({ resources: [] });
      promptAggregation.listPrompts.mockResolvedValue({ prompts: [] });

      await tool.execute({}, {});

      expect(clientPool.getClientsBySession).toHaveBeenCalledWith("default");
    });

    it("should include failed server count when servers failed", async () => {
      const mockClient = { listTools: async () => [] };

      clientPool.getClientsBySession.mockReturnValue(
        new Map([["server1", mockClient]]),
      );
      clientPool.getFailedServers.mockReturnValue(
        new Map([
          ["failed1", new Error("Connection failed")],
          ["failed2", new Error("Timeout")],
        ]),
      );

      resourceAggregation.listResources.mockResolvedValue({ resources: [] });
      promptAggregation.listPrompts.mockResolvedValue({ prompts: [] });

      const result = await tool.execute({}, { sessionId: "test" });

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("1 connected");
      expect(text).toContain("2 failed");
      expect(text).toContain("3 total");
    });

    it("should not show failed count when no servers failed", async () => {
      clientPool.getClientsBySession.mockReturnValue(new Map());
      clientPool.getFailedServers.mockReturnValue(new Map());
      resourceAggregation.listResources.mockResolvedValue({ resources: [] });
      promptAggregation.listPrompts.mockResolvedValue({ prompts: [] });

      const result = await tool.execute({}, { sessionId: "test" });

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).not.toContain("failed");
    });

    it("should handle zero servers gracefully", async () => {
      clientPool.getClientsBySession.mockReturnValue(new Map());
      clientPool.getFailedServers.mockReturnValue(new Map());
      resourceAggregation.listResources.mockResolvedValue({ resources: [] });
      promptAggregation.listPrompts.mockResolvedValue({ prompts: [] });

      const result = await tool.execute({}, { sessionId: "test" });

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Servers: 0 connected");
      expect(text).toContain("Tools: 0");
      expect(text).toContain("Resources: 0");
      expect(text).toContain("Prompts: 0");
    });

    it("should handle tool listing errors gracefully", async () => {
      const mockClient = {
        listTools: async () => {
          throw new Error("Failed to list tools");
        },
      };

      clientPool.getClientsBySession.mockReturnValue(
        new Map([["server1", mockClient]]),
      );
      clientPool.getFailedServers.mockReturnValue(new Map());
      resourceAggregation.listResources.mockResolvedValue({ resources: [] });
      promptAggregation.listPrompts.mockResolvedValue({ prompts: [] });

      const result = await tool.execute({}, { sessionId: "test" });

      // Should still succeed, just with 0 tools counted
      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Tools: 0");
    });

    it("should return error when aggregation services fail", async () => {
      clientPool.getClientsBySession.mockReturnValue(new Map());
      clientPool.getFailedServers.mockReturnValue(new Map());
      resourceAggregation.listResources.mockRejectedValue(
        new Error("Resource aggregation failed"),
      );

      const result = await tool.execute({}, { sessionId: "test" });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Failed to gather summary stats");
    });

    it("should ignore any args passed (tool takes no parameters)", async () => {
      clientPool.getClientsBySession.mockReturnValue(new Map());
      clientPool.getFailedServers.mockReturnValue(new Map());
      resourceAggregation.listResources.mockResolvedValue({ resources: [] });
      promptAggregation.listPrompts.mockResolvedValue({ prompts: [] });

      const args = { someRandomArg: "ignored", anotherArg: 123 };

      const result = await tool.execute(args, { sessionId: "test" });

      expect(result.isError).toBeUndefined();
    });
  });
});
