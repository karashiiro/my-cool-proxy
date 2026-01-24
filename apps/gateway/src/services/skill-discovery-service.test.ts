import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { SkillDiscoveryService } from "./skill-discovery-service.js";
import type { ILogger, ServerConfig } from "../types/interfaces.js";

// Mock the skills-paths module to use our temp directory
vi.mock("../utils/skills-paths.js", () => ({
  SKILLS_DIRNAME: "skills",
  SKILL_FILENAME: "SKILL.md",
  getSkillsDir: vi.fn(),
}));

import { getSkillsDir } from "../utils/skills-paths.js";

describe("SkillDiscoveryService", () => {
  let service: SkillDiscoveryService;
  let tempDir: string;
  let skillsDir: string;
  let mockLogger: ILogger;
  let mockConfig: ServerConfig;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = resolve(
      tmpdir(),
      `skill-discovery-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    skillsDir = resolve(tempDir, "skills");
    mkdirSync(skillsDir, { recursive: true });

    // Configure mock to return our temp skills directory
    vi.mocked(getSkillsDir).mockReturnValue(skillsDir);

    // Create mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Create mock config with skills disabled by default
    mockConfig = {
      port: 3000,
      host: "localhost",
      transport: "http",
      mcpClients: {},
      skills: { enabled: true, mutable: false },
    };

    // Create fresh service for each test
    service = new SkillDiscoveryService(mockLogger, mockConfig);
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe("discoverSkills", () => {
    it("should return empty array when skills directory does not exist", async () => {
      // Point to non-existent directory
      vi.mocked(getSkillsDir).mockReturnValue(resolve(tempDir, "nonexistent"));

      // Create fresh service to pick up new mock value
      service = new SkillDiscoveryService(mockLogger, mockConfig);

      const skills = await service.discoverSkills();

      expect(skills).toEqual([]);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Skills directory does not exist"),
      );
    });

    it("should return empty array when skills directory is empty", async () => {
      const skills = await service.discoverSkills();

      expect(skills).toEqual([]);
      expect(mockLogger.info).toHaveBeenCalledWith("Discovered 0 skill(s) from disk");
    });

    it("should correctly parse skill with valid frontmatter", async () => {
      // Create a skill directory with valid SKILL.md
      const skillDir = resolve(skillsDir, "my-skill");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: My Awesome Skill
description: Does really cool things
---

# Instructions

Some content here...
`,
      );

      const skills = await service.discoverSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0]).toEqual({
        name: "My Awesome Skill",
        description: "Does really cool things",
        path: skillDir,
      });
    });

    it("should skip directories without SKILL.md", async () => {
      // Create a directory without SKILL.md
      const invalidDir = resolve(skillsDir, "not-a-skill");
      mkdirSync(invalidDir);
      writeFileSync(resolve(invalidDir, "README.md"), "# Not a skill");

      // Create a valid skill directory
      const validDir = resolve(skillsDir, "valid-skill");
      mkdirSync(validDir);
      writeFileSync(
        resolve(validDir, "SKILL.md"),
        `---
name: Valid Skill
description: A valid skill
---
Content`,
      );

      const skills = await service.discoverSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe("Valid Skill");
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Skipping directory without SKILL.md"),
      );
    });

    it("should handle multiple skills", async () => {
      // Create multiple skills
      for (const skillName of ["skill-a", "skill-b", "skill-c"]) {
        const skillDir = resolve(skillsDir, skillName);
        mkdirSync(skillDir);
        writeFileSync(
          resolve(skillDir, "SKILL.md"),
          `---
name: ${skillName}
description: Description for ${skillName}
---
Content`,
        );
      }

      const skills = await service.discoverSkills();

      expect(skills).toHaveLength(3);
      expect(skills.map((s) => s.name).sort()).toEqual([
        "skill-a",
        "skill-b",
        "skill-c",
      ]);
      expect(mockLogger.info).toHaveBeenCalledWith("Discovered 3 skill(s) from disk");
    });

    it("should use directory name as fallback when name field is missing", async () => {
      const skillDir = resolve(skillsDir, "fallback-name-skill");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
description: A skill without a name field
---
Content`,
      );

      const skills = await service.discoverSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe("fallback-name-skill");
      expect(skills[0]!.description).toBe("A skill without a name field");
    });

    it("should handle quoted values in frontmatter", async () => {
      const skillDir = resolve(skillsDir, "quoted-skill");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: "Quoted Skill Name"
description: 'Single quoted description'
---
Content`,
      );

      const skills = await service.discoverSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe("Quoted Skill Name");
      expect(skills[0]!.description).toBe("Single quoted description");
    });

    it("should handle quotes inside values with opposite quote type", async () => {
      const skillDir = resolve(skillsDir, "nested-quotes-skill");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: "Skill with 'apostrophes' inside"
description: 'Description with "quotes" inside'
---
Content`,
      );

      const skills = await service.discoverSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe("Skill with 'apostrophes' inside");
      expect(skills[0]!.description).toBe('Description with "quotes" inside');
    });

    it("should handle multiline YAML descriptions", async () => {
      const skillDir = resolve(skillsDir, "multiline-skill");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: Multiline Skill
description: >
  This is a long description
  that spans multiple lines
  and should be joined together.
---
Content`,
      );

      const skills = await service.discoverSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe("Multiline Skill");
      expect(skills[0]!.description).toContain("This is a long description");
      expect(skills[0]!.description).toContain("spans multiple lines");
    });

    it("should skip skills with invalid YAML frontmatter", async () => {
      const skillDir = resolve(skillsDir, "invalid-yaml-skill");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: [invalid yaml
description: this: is: also: broken
---
Content`,
      );

      const skills = await service.discoverSkills();

      expect(skills).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Invalid YAML"),
      );
    });

    it("should skip files that are not directories", async () => {
      // Create a regular file in skills directory
      writeFileSync(resolve(skillsDir, "not-a-directory.txt"), "Just a file");

      // Create a valid skill
      const skillDir = resolve(skillsDir, "real-skill");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: Real Skill
description: A real skill
---
Content`,
      );

      const skills = await service.discoverSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe("Real Skill");
    });

    it("should warn but skip skills without frontmatter", async () => {
      const skillDir = resolve(skillsDir, "no-frontmatter");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `# No Frontmatter

Just some markdown without YAML frontmatter.
`,
      );

      const skills = await service.discoverSkills();

      expect(skills).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("No frontmatter found"),
      );
    });

    it("should warn when skill has no description", async () => {
      const skillDir = resolve(skillsDir, "no-description");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: No Description Skill
---
Content`,
      );

      const skills = await service.discoverSkills();

      expect(skills).toHaveLength(1);
      expect(skills[0]!.description).toBe("");
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("has no description"),
      );
    });

    it("should cache results and not re-scan on subsequent calls", async () => {
      const skillDir = resolve(skillsDir, "cached-skill");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: Cached Skill
description: Will be cached
---
Content`,
      );

      // First call
      const skills1 = await service.discoverSkills();
      expect(skills1).toHaveLength(1);

      // Clear the mock to verify no new reads happen
      vi.mocked(mockLogger.info).mockClear();

      // Add another skill (should not be picked up due to caching)
      const skillDir2 = resolve(skillsDir, "new-skill");
      mkdirSync(skillDir2);
      writeFileSync(
        resolve(skillDir2, "SKILL.md"),
        `---
name: New Skill
description: Added after cache
---
Content`,
      );

      // Second call should return cached results
      const skills2 = await service.discoverSkills();
      expect(skills2).toHaveLength(1);
      expect(skills2[0]!.name).toBe("Cached Skill");

      // Should not log discovery again (cached)
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe("getSkillContent", () => {
    it("should return full content for existing skill", async () => {
      const skillDir = resolve(skillsDir, "content-skill");
      mkdirSync(skillDir);
      const fullContent = `---
name: Content Skill
description: Test getting content
---

# Full Instructions

This is the full content of the skill.

## Steps

1. Do this
2. Do that
3. Done!
`;
      writeFileSync(resolve(skillDir, "SKILL.md"), fullContent);

      const content = await service.getSkillContent("Content Skill");

      expect(content).toBe(fullContent);
    });

    it("should return null for non-existent skill", async () => {
      const content = await service.getSkillContent("Non Existent Skill");

      expect(content).toBeNull();
    });

    it("should discover skills first if not already cached", async () => {
      const skillDir = resolve(skillsDir, "lazy-skill");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: Lazy Skill
description: Discovered on demand
---
Content here`,
      );

      // Call getSkillContent directly without prior discoverSkills call
      const content = await service.getSkillContent("Lazy Skill");

      expect(content).toBe(`---
name: Lazy Skill
description: Discovered on demand
---
Content here`);
    });

    it("should handle read errors gracefully", async () => {
      const skillDir = resolve(skillsDir, "error-skill");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: Error Skill
description: Will cause read error
---
Content`,
      );

      // Discover skills first
      await service.discoverSkills();

      // Delete the SKILL.md to cause a read error
      rmSync(resolve(skillDir, "SKILL.md"));

      const content = await service.getSkillContent("Error Skill");

      expect(content).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to read skill content"),
        expect.any(Error),
      );
    });
  });

  describe("getSkillResource", () => {
    it("should return content of a script file", async () => {
      const skillDir = resolve(skillsDir, "resource-skill");
      mkdirSync(skillDir);
      mkdirSync(resolve(skillDir, "scripts"));
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: resource-skill
description: Has resources
---
Content`,
      );
      writeFileSync(
        resolve(skillDir, "scripts", "extract.py"),
        "#!/usr/bin/env python\nprint('Hello')",
      );

      const content = await service.getSkillResource(
        "resource-skill",
        "scripts/extract.py",
      );

      expect(content).toBe("#!/usr/bin/env python\nprint('Hello')");
    });

    it("should return content of a reference file", async () => {
      const skillDir = resolve(skillsDir, "ref-skill");
      mkdirSync(skillDir);
      mkdirSync(resolve(skillDir, "references"));
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: ref-skill
description: Has references
---
Content`,
      );
      writeFileSync(
        resolve(skillDir, "references", "REFERENCE.md"),
        "# Reference\n\nDetailed docs here.",
      );

      const content = await service.getSkillResource(
        "ref-skill",
        "references/REFERENCE.md",
      );

      expect(content).toBe("# Reference\n\nDetailed docs here.");
    });

    it("should return null for non-existent skill", async () => {
      const content = await service.getSkillResource(
        "non-existent",
        "scripts/foo.py",
      );

      expect(content).toBeNull();
    });

    it("should return null for non-existent resource file", async () => {
      const skillDir = resolve(skillsDir, "no-resource-skill");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: no-resource-skill
description: No resources
---
Content`,
      );

      const content = await service.getSkillResource(
        "no-resource-skill",
        "scripts/missing.py",
      );

      expect(content).toBeNull();
    });

    it("should throw error for path traversal attempt with ../", async () => {
      const skillDir = resolve(skillsDir, "traversal-skill");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: traversal-skill
description: Test traversal protection
---
Content`,
      );

      await expect(
        service.getSkillResource("traversal-skill", "../../../etc/passwd"),
      ).rejects.toThrow("path must be within the skill directory");

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Path traversal detected"),
      );
    });

    it("should throw error for absolute path attempt", async () => {
      const skillDir = resolve(skillsDir, "absolute-skill");
      mkdirSync(skillDir);
      writeFileSync(
        resolve(skillDir, "SKILL.md"),
        `---
name: absolute-skill
description: Test absolute path protection
---
Content`,
      );

      // Note: resolve() with an absolute path will ignore the base
      await expect(
        service.getSkillResource("absolute-skill", "/etc/passwd"),
      ).rejects.toThrow("path must be within the skill directory");
    });
  });
});
