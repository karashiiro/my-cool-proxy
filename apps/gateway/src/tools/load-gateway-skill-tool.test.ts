import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoadGatewaySkillTool } from "./load-gateway-skill-tool.js";
import type { ILogger, ISkillDiscoveryService } from "../types/interfaces.js";

describe("LoadGatewaySkillTool", () => {
  let tool: LoadGatewaySkillTool;
  let mockSkillService: ISkillDiscoveryService;
  let mockLogger: ILogger;

  beforeEach(() => {
    mockSkillService = {
      discoverSkills: vi.fn(),
      getSkillContent: vi.fn(),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    tool = new LoadGatewaySkillTool(mockSkillService, mockLogger);
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      expect(tool.name).toBe("load-gateway-skill");
    });

    it("should have description mentioning gateway skills", () => {
      expect(tool.description).toContain("gateway skill");
      expect(tool.description).toContain("full content");
    });

    it("should have skillName in schema", () => {
      expect(tool.schema.skillName).toBeDefined();
    });
  });

  describe("execute", () => {
    it("should return skill content when skill exists", async () => {
      const skillContent = `---
name: Test Skill
description: A test skill
---

# Instructions

Do the thing!
`;
      vi.mocked(mockSkillService.getSkillContent).mockResolvedValue(
        skillContent,
      );

      const result = await tool.execute({ skillName: "Test Skill" });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");
      expect((result.content[0] as { type: "text"; text: string }).text).toBe(
        skillContent,
      );
      expect(mockSkillService.getSkillContent).toHaveBeenCalledWith(
        "Test Skill",
      );
    });

    it("should return error when skill not found", async () => {
      vi.mocked(mockSkillService.getSkillContent).mockResolvedValue(null);

      const result = await tool.execute({ skillName: "Nonexistent Skill" });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Nonexistent Skill");
      expect(text).toContain("not found");
    });

    it("should call skillService.getSkillContent with correct name", async () => {
      vi.mocked(mockSkillService.getSkillContent).mockResolvedValue("content");

      await tool.execute({ skillName: "My Special Skill" });

      expect(mockSkillService.getSkillContent).toHaveBeenCalledWith(
        "My Special Skill",
      );
    });

    it("should handle skill names with special characters", async () => {
      vi.mocked(mockSkillService.getSkillContent).mockResolvedValue("content");

      await tool.execute({
        skillName: "Skill <with> 'special' \"chars\" & symbols",
      });

      expect(mockSkillService.getSkillContent).toHaveBeenCalledWith(
        "Skill <with> 'special' \"chars\" & symbols",
      );
    });

    it("should log when skill is found", async () => {
      vi.mocked(mockSkillService.getSkillContent).mockResolvedValue("content");

      await tool.execute({ skillName: "Test Skill" });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Test Skill"),
      );
    });

    it("should log warning when skill not found", async () => {
      vi.mocked(mockSkillService.getSkillContent).mockResolvedValue(null);

      await tool.execute({ skillName: "Missing Skill" });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Missing Skill"),
      );
    });
  });
});
