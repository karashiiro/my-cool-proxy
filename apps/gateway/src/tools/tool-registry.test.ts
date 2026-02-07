import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolRegistry } from "./tool-registry.js";
import type { ITool } from "./base-tool.js";

// Mock tool factory for testing
const createMockTool = (name: string): ITool => ({
  name,
  description: `Description for ${name}`,
  schema: {},
  execute: vi.fn().mockResolvedValue({ success: true }),
});

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe("register", () => {
    it("should register a tool", () => {
      const tool = createMockTool("test-tool");

      registry.register(tool);

      expect(registry.get("test-tool")).toBe(tool);
    });

    it("should register multiple tools", () => {
      const tool1 = createMockTool("tool-1");
      const tool2 = createMockTool("tool-2");
      const tool3 = createMockTool("tool-3");

      registry.register(tool1);
      registry.register(tool2);
      registry.register(tool3);

      expect(registry.get("tool-1")).toBe(tool1);
      expect(registry.get("tool-2")).toBe(tool2);
      expect(registry.get("tool-3")).toBe(tool3);
    });

    it("should overwrite existing tool with same name", () => {
      const originalTool = createMockTool("duplicate");
      const newTool = createMockTool("duplicate");

      registry.register(originalTool);
      registry.register(newTool);

      expect(registry.get("duplicate")).toBe(newTool);
      expect(registry.getAll()).toHaveLength(1);
    });
  });

  describe("get", () => {
    it("should return undefined for non-existent tool", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    it("should return the registered tool", () => {
      const tool = createMockTool("my-tool");
      registry.register(tool);

      const result = registry.get("my-tool");

      expect(result).toBe(tool);
      expect(result?.name).toBe("my-tool");
    });
  });

  describe("getAll", () => {
    it("should return empty array when no tools registered", () => {
      expect(registry.getAll()).toEqual([]);
    });

    it("should return all registered tools", () => {
      const tool1 = createMockTool("alpha");
      const tool2 = createMockTool("beta");
      const tool3 = createMockTool("gamma");

      registry.register(tool1);
      registry.register(tool2);
      registry.register(tool3);

      const allTools = registry.getAll();

      expect(allTools).toHaveLength(3);
      expect(allTools).toContain(tool1);
      expect(allTools).toContain(tool2);
      expect(allTools).toContain(tool3);
    });

    it("should return a new array each time", () => {
      const tool = createMockTool("singleton");
      registry.register(tool);

      const first = registry.getAll();
      const second = registry.getAll();

      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    });
  });
});
