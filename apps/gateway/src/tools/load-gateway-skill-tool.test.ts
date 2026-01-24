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
      getSkillResource: vi.fn(),
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

    it("should have description mentioning gateway skills and resources", () => {
      expect(tool.description).toContain("gateway skill");
      expect(tool.description).toContain("path");
      expect(tool.description).toContain("scripts");
    });

    it("should have skillName and optional path in schema", () => {
      expect(tool.schema.skillName).toBeDefined();
      expect(tool.schema.path).toBeDefined();
    });
  });

  describe("execute - loading SKILL.md (no path)", () => {
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

    it("should log when skill is found", async () => {
      vi.mocked(mockSkillService.getSkillContent).mockResolvedValue("content");

      await tool.execute({ skillName: "Test Skill" });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Test Skill"),
      );
    });
  });

  describe("execute - loading resources (with path)", () => {
    it("should return resource content when resource exists", async () => {
      const scriptContent = "#!/usr/bin/env python\nprint('Hello')";
      vi.mocked(mockSkillService.getSkillResource).mockResolvedValue(
        scriptContent,
      );

      const result = await tool.execute({
        skillName: "my-skill",
        path: "scripts/extract.py",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect((result.content[0] as { type: "text"; text: string }).text).toBe(
        scriptContent,
      );
      expect(mockSkillService.getSkillResource).toHaveBeenCalledWith(
        "my-skill",
        "scripts/extract.py",
      );
    });

    it("should return error when resource not found", async () => {
      vi.mocked(mockSkillService.getSkillResource).mockResolvedValue(null);

      const result = await tool.execute({
        skillName: "my-skill",
        path: "scripts/missing.py",
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("scripts/missing.py");
      expect(text).toContain("not found");
    });

    it("should return error message on path traversal attempt", async () => {
      vi.mocked(mockSkillService.getSkillResource).mockRejectedValue(
        new Error(
          "Invalid path: '../etc/passwd' - path must be within the skill directory",
        ),
      );

      const result = await tool.execute({
        skillName: "my-skill",
        path: "../etc/passwd",
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("path must be within the skill directory");
    });

    it("should call getSkillResource not getSkillContent when path is provided", async () => {
      vi.mocked(mockSkillService.getSkillResource).mockResolvedValue("content");

      await tool.execute({
        skillName: "my-skill",
        path: "references/REFERENCE.md",
      });

      expect(mockSkillService.getSkillResource).toHaveBeenCalled();
      expect(mockSkillService.getSkillContent).not.toHaveBeenCalled();
    });

    it("should call getSkillContent when path is not provided", async () => {
      vi.mocked(mockSkillService.getSkillContent).mockResolvedValue("content");

      await tool.execute({ skillName: "my-skill" });

      expect(mockSkillService.getSkillContent).toHaveBeenCalled();
      expect(mockSkillService.getSkillResource).not.toHaveBeenCalled();
    });

    it("should log when resource is loaded", async () => {
      vi.mocked(mockSkillService.getSkillResource).mockResolvedValue("content");

      await tool.execute({
        skillName: "my-skill",
        path: "scripts/test.py",
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("my-skill/scripts/test.py"),
      );
    });
  });
});
