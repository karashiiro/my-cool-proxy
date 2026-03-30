import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import {
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { SkillOperationsService } from "./skill-operations-service.js";
import type { ILogger, ISkillDiscoveryService } from "../types/interfaces.js";

// Mock the skills module to use our temp directory
vi.mock("../utils/skills.js", () => ({
  SKILLS_DIRNAME: "skills",
  SKILL_FILENAME: "SKILL.md",
  getSkillsDir: vi.fn(),
}));

import { getSkillsDir } from "../utils/skills.js";

describe("SkillOperationsService", () => {
  let service: SkillOperationsService;
  let tempDir: string;
  let skillsDir: string;
  let mockLogger: ILogger;
  let mockSkillDiscovery: ISkillDiscoveryService;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = resolve(
      tmpdir(),
      `skill-ops-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    skillsDir = resolve(tempDir, "skills");
    mkdirSync(skillsDir, { recursive: true });

    vi.mocked(getSkillsDir).mockReturnValue(skillsDir);

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
    };

    mockSkillDiscovery = {
      discoverSkills: vi.fn().mockResolvedValue([]),
      getSkillContent: vi.fn().mockResolvedValue(null),
      getSkillResource: vi.fn().mockResolvedValue(null),
      ensureSkillsDirectory: vi.fn(),
    };

    service = new SkillOperationsService(mockLogger, mockSkillDiscovery);
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // validateFrontmatter
  // ---------------------------------------------------------------------------

  describe("validateFrontmatter", () => {
    it("should return undefined for valid frontmatter with name and description", () => {
      const content = `---\nname: My Skill\ndescription: Does things\n---\n\n# Content`;
      expect(service.validateFrontmatter(content)).toBeUndefined();
    });

    it("should return undefined for valid frontmatter with only name", () => {
      const content = `---\nname: My Skill\n---\n\n# Content`;
      expect(service.validateFrontmatter(content)).toBeUndefined();
    });

    it("should return undefined for valid frontmatter with only description", () => {
      const content = `---\ndescription: Does things\n---\n\n# Content`;
      expect(service.validateFrontmatter(content)).toBeUndefined();
    });

    it("should return error when no frontmatter present", () => {
      const content = `# Just a title\n\nSome content`;
      const result = service.validateFrontmatter(content);
      expect(result).toContain("YAML frontmatter");
    });

    it("should return error when frontmatter has no name or description", () => {
      const content = `---\nother: value\n---\n\n# Content`;
      const result = service.validateFrontmatter(content);
      expect(result).toContain("name");
      expect(result).toContain("description");
    });

    it("should return error for invalid YAML in frontmatter", () => {
      const content = `---\nname: [broken yaml\n---\n\n# Content`;
      const result = service.validateFrontmatter(content);
      expect(result).toContain("Invalid YAML");
    });

    it("should return error when frontmatter is empty", () => {
      const content = `---\n\n---\n\n# Content`;
      const result = service.validateFrontmatter(content);
      expect(result).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // validateFilePath
  // ---------------------------------------------------------------------------

  describe("validateFilePath", () => {
    it("should return undefined for a valid relative path", () => {
      expect(service.validateFilePath("scripts/run.py")).toBeUndefined();
    });

    it("should return undefined for a simple filename", () => {
      expect(service.validateFilePath("run.py")).toBeUndefined();
    });

    it("should reject paths starting with /", () => {
      const result = service.validateFilePath("/etc/passwd");
      expect(result).toContain("path traversal");
    });

    it("should reject paths starting with ..", () => {
      const result = service.validateFilePath("../../../etc/passwd");
      expect(result).toContain("path traversal");
    });

    it("should reject paths containing /../", () => {
      const result = service.validateFilePath("scripts/../../../etc/passwd");
      expect(result).toContain("path traversal");
    });

    it("should reject paths ending with /..", () => {
      const result = service.validateFilePath("scripts/..");
      expect(result).toContain("path traversal");
    });

    it("should reject absolute Windows paths", () => {
      const result = service.validateFilePath("C:\\Windows\\system32");
      expect(result).toContain("absolute paths");
    });

    it("should reject Windows paths with forward slashes", () => {
      const result = service.validateFilePath("C:/Windows/system32");
      expect(result).toContain("absolute paths");
    });

    it("should handle backslash path separators in traversal check", () => {
      // The function normalizes backslashes before checking
      const result = service.validateFilePath("scripts\\..\\..\\etc");
      // After normalization: "scripts/../../etc" which contains "/../"
      expect(result).toContain("path traversal");
    });
  });

  // ---------------------------------------------------------------------------
  // executeSkillScript
  // ---------------------------------------------------------------------------

  describe("executeSkillScript", () => {
    it("should return error when skill is not found", async () => {
      (mockSkillDiscovery.discoverSkills as Mock).mockResolvedValue([]);

      const result = await service.executeSkillScript(
        "nonexistent-skill",
        "run.sh",
        [],
      );

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("not found"),
        }),
      );
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("should reject script names containing forward slash (path traversal)", async () => {
      (mockSkillDiscovery.discoverSkills as Mock).mockResolvedValue([
        { name: "my-skill", description: "test", path: skillsDir },
      ]);

      const result = await service.executeSkillScript(
        "my-skill",
        "../evil/run.sh",
        [],
      );

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("Invalid script name"),
        }),
      );
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("should reject script names containing backslash (path traversal)", async () => {
      (mockSkillDiscovery.discoverSkills as Mock).mockResolvedValue([
        { name: "my-skill", description: "test", path: skillsDir },
      ]);

      const result = await service.executeSkillScript(
        "my-skill",
        "..\\evil\\run.sh",
        [],
      );

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("Invalid script name"),
        }),
      );
    });

    it("should return error when script file does not exist", async () => {
      const skillDir = resolve(skillsDir, "my-skill");
      mkdirSync(resolve(skillDir, "scripts"), { recursive: true });

      (mockSkillDiscovery.discoverSkills as Mock).mockResolvedValue([
        { name: "my-skill", description: "test", path: skillDir },
      ]);

      const result = await service.executeSkillScript(
        "my-skill",
        "missing.sh",
        [],
      );

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("not found in skill"),
        }),
      );
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("should return error when script path is not a file", async () => {
      const skillDir = resolve(skillsDir, "dir-skill");
      const scriptsDir = resolve(skillDir, "scripts");
      mkdirSync(scriptsDir, { recursive: true });
      // Create a directory where a file is expected
      mkdirSync(resolve(scriptsDir, "notafile.sh"), { recursive: true });

      (mockSkillDiscovery.discoverSkills as Mock).mockResolvedValue([
        { name: "dir-skill", description: "test", path: skillDir },
      ]);

      const result = await service.executeSkillScript(
        "dir-skill",
        "notafile.sh",
        [],
      );

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("not a file"),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // writeSkillFiles
  // ---------------------------------------------------------------------------

  describe("writeSkillFiles", () => {
    it("should return error when neither content nor files provided", async () => {
      const result = await service.writeSkillFiles("my-skill");

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("At least one of"),
        }),
      );
    });

    it("should return error when files array is empty", async () => {
      const result = await service.writeSkillFiles("my-skill", undefined, []);

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("At least one of"),
        }),
      );
    });

    it("should return error when skill name contains path separator", async () => {
      const result = await service.writeSkillFiles(
        "../evil",
        "---\nname: evil\ndescription: bad\n---\n# Content",
      );

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("path separators"),
        }),
      );
    });

    it("should return error when content has invalid frontmatter", async () => {
      const result = await service.writeSkillFiles(
        "my-skill",
        "# No frontmatter here",
      );

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("frontmatter"),
        }),
      );
    });

    it("should return error when a file path has path traversal", async () => {
      const result = await service.writeSkillFiles("my-skill", undefined, [
        { path: "../../../etc/evil", content: "oops" },
      ]);

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("path traversal"),
        }),
      );
    });

    it("should successfully create a skill with valid SKILL.md content", async () => {
      const skillContent = `---\nname: My New Skill\ndescription: Does great things\n---\n\n# Instructions\n\nDo stuff.`;

      (mockSkillDiscovery.discoverSkills as Mock).mockResolvedValue([
        {
          name: "My New Skill",
          description: "Does great things",
          path: resolve(skillsDir, "my-new-skill"),
        },
      ]);

      const result = await service.writeSkillFiles(
        "my-new-skill",
        skillContent,
      );

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          writtenFiles: ["SKILL.md"],
          skill: expect.objectContaining({
            name: "My New Skill",
            description: "Does great things",
          }),
        }),
      );

      // Verify file was actually written
      const skillFilePath = resolve(skillsDir, "my-new-skill", "SKILL.md");
      expect(existsSync(skillFilePath)).toBe(true);
    });

    it("should successfully write additional files", async () => {
      const skillContent = `---\nname: Script Skill\ndescription: Has scripts\n---\n\n# Instructions`;
      const files = [
        { path: "scripts/run.sh", content: "#!/bin/bash\necho hi" },
      ];

      (mockSkillDiscovery.discoverSkills as Mock).mockResolvedValue([
        {
          name: "Script Skill",
          description: "Has scripts",
          path: resolve(skillsDir, "script-skill"),
        },
      ]);

      const result = await service.writeSkillFiles(
        "script-skill",
        skillContent,
        files,
      );

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          writtenFiles: expect.arrayContaining(["SKILL.md", "scripts/run.sh"]),
        }),
      );

      const scriptPath = resolve(
        skillsDir,
        "script-skill",
        "scripts",
        "run.sh",
      );
      expect(existsSync(scriptPath)).toBe(true);
    });

    it("should write files only (without SKILL.md) when no content provided", async () => {
      // First create the skill dir so the write works
      const skillDir = resolve(skillsDir, "files-only-skill");
      mkdirSync(skillDir, { recursive: true });

      const files = [{ path: "scripts/helper.py", content: "print('hello')" }];

      (mockSkillDiscovery.discoverSkills as Mock).mockResolvedValue([
        {
          name: "files-only-skill",
          description: "Files only",
          path: skillDir,
        },
      ]);

      const result = await service.writeSkillFiles(
        "files-only-skill",
        undefined,
        files,
      );

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          writtenFiles: ["scripts/helper.py"],
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updateSkillFile
  // ---------------------------------------------------------------------------

  describe("updateSkillFile", () => {
    const validSkillContent = `---\nname: Test Skill\ndescription: A test skill\n---\n\n# Instructions\n\nDo the thing.`;

    function createSkillFile(
      skillName: string,
      file: string,
      content: string,
    ): void {
      const dir = resolve(skillsDir, skillName);
      const filePath = resolve(dir, file);
      mkdirSync(resolve(filePath, ".."), { recursive: true });
      writeFileSync(filePath, content, "utf-8");
    }

    it("should successfully replace a unique string", async () => {
      createSkillFile("my-skill", "SKILL.md", validSkillContent);

      const result = await service.updateSkillFile(
        "my-skill",
        "SKILL.md",
        "Do the thing.",
        "Do the other thing.",
      );

      expect(result).toEqual({
        success: true,
        file: "SKILL.md",
        replacements: 1,
      });

      const updated = readFileSync(
        resolve(skillsDir, "my-skill", "SKILL.md"),
        "utf-8",
      );
      expect(updated).toContain("Do the other thing.");
      expect(updated).not.toContain("Do the thing.");
    });

    it("should return error when old_string is not found", async () => {
      createSkillFile("my-skill", "SKILL.md", validSkillContent);

      const result = await service.updateSkillFile(
        "my-skill",
        "SKILL.md",
        "this text does not exist",
        "replacement",
      );

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("not found"),
        }),
      );
    });

    it("should return error when multiple matches without replace_all", async () => {
      const content = `---\nname: Test\ndescription: Test\n---\n\nfoo bar foo`;
      createSkillFile("my-skill", "SKILL.md", content);

      const result = await service.updateSkillFile(
        "my-skill",
        "SKILL.md",
        "foo",
        "baz",
      );

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("2 times"),
        }),
      );

      // Verify file was not modified
      const unchanged = readFileSync(
        resolve(skillsDir, "my-skill", "SKILL.md"),
        "utf-8",
      );
      expect(unchanged).toContain("foo bar foo");
    });

    it("should replace all occurrences when replace_all is true", async () => {
      const content = `---\nname: Test\ndescription: Test\n---\n\nfoo bar foo`;
      createSkillFile("my-skill", "SKILL.md", content);

      const result = await service.updateSkillFile(
        "my-skill",
        "SKILL.md",
        "foo",
        "baz",
        true,
      );

      expect(result).toEqual({
        success: true,
        file: "SKILL.md",
        replacements: 2,
      });

      const updated = readFileSync(
        resolve(skillsDir, "my-skill", "SKILL.md"),
        "utf-8",
      );
      expect(updated).toContain("baz bar baz");
    });

    it("should reject path traversal in file parameter", async () => {
      createSkillFile("my-skill", "SKILL.md", validSkillContent);

      const result = await service.updateSkillFile(
        "my-skill",
        "../../../etc/passwd",
        "old",
        "new",
      );

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("path traversal"),
        }),
      );
    });

    it("should reject skill names with path separators", async () => {
      const result = await service.updateSkillFile(
        "../evil",
        "SKILL.md",
        "old",
        "new",
      );

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("path separators"),
        }),
      );
    });

    it("should return error when file does not exist", async () => {
      mkdirSync(resolve(skillsDir, "my-skill"), { recursive: true });

      const result = await service.updateSkillFile(
        "my-skill",
        "nonexistent.md",
        "old",
        "new",
      );

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("not found"),
        }),
      );
    });

    it("should reject replacement that breaks SKILL.md frontmatter", async () => {
      createSkillFile("my-skill", "SKILL.md", validSkillContent);

      const result = await service.updateSkillFile(
        "my-skill",
        "SKILL.md",
        "---\nname: Test Skill\ndescription: A test skill\n---",
        "no frontmatter here",
      );

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining("frontmatter"),
        }),
      );

      // Verify file was not modified
      const unchanged = readFileSync(
        resolve(skillsDir, "my-skill", "SKILL.md"),
        "utf-8",
      );
      expect(unchanged).toBe(validSkillContent);
    });

    it("should treat $ patterns in new_string as literal text", async () => {
      createSkillFile("my-skill", "scripts/config.txt", "price: PLACEHOLDER");

      const result = await service.updateSkillFile(
        "my-skill",
        "scripts/config.txt",
        "PLACEHOLDER",
        "$100 ($& is literal)",
      );

      expect(result).toEqual({
        success: true,
        file: "scripts/config.txt",
        replacements: 1,
      });

      const updated = readFileSync(
        resolve(skillsDir, "my-skill", "scripts", "config.txt"),
        "utf-8",
      );
      // $& and $100 should be literal, not interpreted as replacement patterns
      expect(updated).toBe("price: $100 ($& is literal)");
    });

    it("should work on non-SKILL.md files without frontmatter validation", async () => {
      createSkillFile("my-skill", "scripts/helper.py", "print('hello')");

      const result = await service.updateSkillFile(
        "my-skill",
        "scripts/helper.py",
        "hello",
        "world",
      );

      expect(result).toEqual({
        success: true,
        file: "scripts/helper.py",
        replacements: 1,
      });

      const updated = readFileSync(
        resolve(skillsDir, "my-skill", "scripts", "helper.py"),
        "utf-8",
      );
      expect(updated).toBe("print('world')");
    });
  });

  // ---------------------------------------------------------------------------
  // getSkillMetadata
  // ---------------------------------------------------------------------------

  describe("getSkillMetadata", () => {
    it("should extract metadata from provided content frontmatter", async () => {
      const content = `---\nname: Extracted Skill\ndescription: Pulled from content\n---\n\n# Content`;
      const skillDir = resolve(skillsDir, "test-skill");

      const metadata = await service.getSkillMetadata(
        "test-skill",
        skillDir,
        content,
      );

      expect(metadata.name).toBe("Extracted Skill");
      expect(metadata.description).toBe("Pulled from content");
      expect(metadata.path).toBe(skillDir);
    });

    it("should fall back to skillName when content has no parseable frontmatter", async () => {
      const content = `# No frontmatter`;
      const skillDir = resolve(skillsDir, "fallback-skill");

      (mockSkillDiscovery.discoverSkills as Mock).mockResolvedValue([]);

      const metadata = await service.getSkillMetadata(
        "fallback-skill",
        skillDir,
        content,
      );

      expect(metadata.name).toBe("fallback-skill");
      expect(metadata.description).toBe("");
      expect(metadata.path).toBe(skillDir);
    });

    it("should discover metadata from skill discovery when no content provided", async () => {
      const skillDir = resolve(skillsDir, "discovered-skill");

      (mockSkillDiscovery.discoverSkills as Mock).mockResolvedValue([
        {
          name: "Discovered Skill",
          description: "Found on disk",
          path: skillDir,
        },
      ]);

      const metadata = await service.getSkillMetadata(
        "discovered-skill",
        skillDir,
      );

      expect(metadata.name).toBe("Discovered Skill");
      expect(metadata.description).toBe("Found on disk");
    });

    it("should return minimal metadata when no content and no discovered skill", async () => {
      const skillDir = resolve(skillsDir, "minimal-skill");

      (mockSkillDiscovery.discoverSkills as Mock).mockResolvedValue([]);

      const metadata = await service.getSkillMetadata(
        "minimal-skill",
        skillDir,
      );

      expect(metadata.name).toBe("minimal-skill");
      expect(metadata.description).toBe("");
      expect(metadata.path).toBe(skillDir);
    });
  });
});
