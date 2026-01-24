import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { WriteGatewaySkillTool } from "./write-gateway-skill-tool.js";
import type { ILogger } from "../types/interfaces.js";
import type { ISkillDiscoveryService } from "../types/skill.js";

// Mock the skills-paths module to use a temp directory
vi.mock("../utils/skills-paths.js", () => {
  return {
    getSkillsDir: vi.fn(),
    SKILL_FILENAME: "SKILL.md",
  };
});

import { getSkillsDir } from "../utils/skills-paths.js";

describe("WriteGatewaySkillTool", () => {
  let tool: WriteGatewaySkillTool;
  let mockSkillService: ISkillDiscoveryService;
  let mockLogger: ILogger;
  let tempDir: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = resolve(
      tmpdir(),
      `write-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });

    // Mock getSkillsDir to return our temp directory
    vi.mocked(getSkillsDir).mockReturnValue(tempDir);

    mockSkillService = {
      discoverSkills: vi.fn().mockResolvedValue([]),
      getSkillContent: vi.fn(),
      getSkillResource: vi.fn(),
      clearCache: vi.fn(),
      ensureSkillsDirectory: vi.fn(),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    tool = new WriteGatewaySkillTool(mockSkillService, mockLogger);
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.clearAllMocks();
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      expect(tool.name).toBe("write-gateway-skill");
    });

    it("should have description mentioning skill creation", () => {
      expect(tool.description).toContain("Create or overwrite");
      expect(tool.description).toContain("gateway skill");
    });

    it("should have required schema fields", () => {
      expect(tool.schema.skillName).toBeDefined();
      expect(tool.schema.content).toBeDefined();
      expect(tool.schema.files).toBeDefined();
    });
  });

  describe("execute - validation", () => {
    it("should require at least content or files", async () => {
      const result = await tool.execute({
        skillName: "test-skill",
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("At least one of");
    });

    it("should reject skill names with path separators (forward slash)", async () => {
      const result = await tool.execute({
        skillName: "bad/skill",
        content: "---\nname: Test\n---\nContent",
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("cannot contain path separators");
    });

    it("should reject skill names with path separators (backslash)", async () => {
      const result = await tool.execute({
        skillName: "bad\\skill",
        content: "---\nname: Test\n---\nContent",
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("cannot contain path separators");
    });

    it("should require valid YAML frontmatter", async () => {
      const result = await tool.execute({
        skillName: "test-skill",
        content: "No frontmatter here!",
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("must include YAML frontmatter");
    });

    it("should require name or description in frontmatter", async () => {
      const result = await tool.execute({
        skillName: "test-skill",
        content: "---\nfoo: bar\n---\nContent",
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("'name' or 'description'");
    });

    it("should reject file paths with path traversal", async () => {
      const result = await tool.execute({
        skillName: "test-skill",
        files: [{ path: "../evil.txt", content: "evil" }],
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("path traversal");
    });

    it("should reject absolute file paths", async () => {
      const result = await tool.execute({
        skillName: "test-skill",
        files: [{ path: "C:/evil.txt", content: "evil" }],
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("absolute paths are not allowed");
    });
  });

  describe("execute - creating skills", () => {
    it("should create a skill with SKILL.md content", async () => {
      const content = `---
name: My Test Skill
description: A test skill for testing
---

# Instructions

Do the thing!
`;
      const result = await tool.execute({
        skillName: "my-test-skill",
        content,
      });

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: "text"; text: string }).text;
      const response = JSON.parse(text);

      expect(response.success).toBe(true);
      expect(response.skill.name).toBe("My Test Skill");
      expect(response.skill.description).toBe("A test skill for testing");
      expect(response.writtenFiles).toContain("SKILL.md");

      // Verify file was actually written
      const skillFilePath = resolve(tempDir, "my-test-skill", "SKILL.md");
      expect(existsSync(skillFilePath)).toBe(true);
      expect(readFileSync(skillFilePath, "utf-8")).toBe(content);
    });

    it("should create resource files", async () => {
      const content = `---
name: Script Skill
description: A skill with scripts
---

# Instructions
`;
      const result = await tool.execute({
        skillName: "script-skill",
        content,
        files: [
          { path: "scripts/extract.py", content: "print('hello')" },
          { path: "references/API.md", content: "# API Docs" },
        ],
      });

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: "text"; text: string }).text;
      const response = JSON.parse(text);

      expect(response.success).toBe(true);
      expect(response.writtenFiles).toContain("scripts/extract.py");
      expect(response.writtenFiles).toContain("references/API.md");

      // Verify files were written
      const scriptPath = resolve(
        tempDir,
        "script-skill",
        "scripts",
        "extract.py",
      );
      expect(existsSync(scriptPath)).toBe(true);
      expect(readFileSync(scriptPath, "utf-8")).toBe("print('hello')");

      const refPath = resolve(tempDir, "script-skill", "references", "API.md");
      expect(existsSync(refPath)).toBe(true);
    });

    it("should create only files without SKILL.md", async () => {
      const result = await tool.execute({
        skillName: "files-only-skill",
        files: [{ path: "assets/data.json", content: '{"key": "value"}' }],
      });

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: "text"; text: string }).text;
      const response = JSON.parse(text);

      expect(response.success).toBe(true);
      expect(response.writtenFiles).toContain("assets/data.json");
      expect(response.writtenFiles).not.toContain("SKILL.md");

      // Verify file was written
      const assetPath = resolve(
        tempDir,
        "files-only-skill",
        "assets",
        "data.json",
      );
      expect(existsSync(assetPath)).toBe(true);
    });

    it("should overwrite existing files", async () => {
      // Create initial skill
      const skillDir = resolve(tempDir, "overwrite-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(resolve(skillDir, "SKILL.md"), "old content");

      // Overwrite with new content
      const newContent = `---
name: Overwritten Skill
description: New description
---

New content!
`;
      const result = await tool.execute({
        skillName: "overwrite-skill",
        content: newContent,
      });

      expect(result.isError).toBeUndefined();

      // Verify file was overwritten
      const content = readFileSync(resolve(skillDir, "SKILL.md"), "utf-8");
      expect(content).toBe(newContent);
    });

    it("should clear the skills cache after creation", async () => {
      const result = await tool.execute({
        skillName: "cache-test-skill",
        content: "---\nname: Cache Test\n---\nContent",
      });

      expect(result.isError).toBeUndefined();
      expect(mockSkillService.clearCache).toHaveBeenCalled();
    });

    it("should use directory name if frontmatter name is missing", async () => {
      const content = `---
description: Only description, no name
---

Content here
`;
      const result = await tool.execute({
        skillName: "directory-name-skill",
        content,
      });

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: "text"; text: string }).text;
      const response = JSON.parse(text);

      expect(response.skill.name).toBe("directory-name-skill");
      expect(response.skill.description).toBe("Only description, no name");
    });
  });

  describe("logging", () => {
    it("should log when creating skill directory", async () => {
      await tool.execute({
        skillName: "logging-test-skill",
        content: "---\nname: Test\n---\nContent",
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Created skill directory"),
      );
    });

    it("should log when writing SKILL.md", async () => {
      await tool.execute({
        skillName: "logging-test-skill",
        content: "---\nname: Test\n---\nContent",
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Wrote SKILL.md"),
      );
    });

    it("should log success summary", async () => {
      await tool.execute({
        skillName: "logging-test-skill",
        content: "---\nname: Test\n---\nContent",
        files: [{ path: "scripts/test.py", content: "test" }],
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("2 file(s)"),
      );
    });
  });
});
