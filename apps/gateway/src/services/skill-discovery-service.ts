import { injectable } from "inversify";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { resolve, sep } from "path";
import { parse as parseYaml } from "yaml";
import type { ILogger, ServerConfig } from "../types/interfaces.js";
import type { ISkillDiscoveryService, SkillMetadata } from "../types/skill.js";
import { getSkillsDir, SKILL_FILENAME } from "../utils/skills-paths.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";

/**
 * Regular expression to extract YAML frontmatter from a markdown file.
 * Matches content between opening and closing `---` delimiters at the start of the file.
 */
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/**
 * Built-in skill name for the skill creation guide.
 */
const BUILTIN_CREATING_SKILLS_NAME = "creating-skills";

/**
 * Built-in skill metadata for the skill creation guide.
 * This skill is virtual (not on disk) and only shown when skills.mutable is true.
 */
const BUILTIN_CREATING_SKILLS_METADATA: SkillMetadata = {
  name: BUILTIN_CREATING_SKILLS_NAME,
  description: "Learn how to create and manage gateway skills",
  path: "", // Virtual skill - no path on disk
};

/**
 * Built-in skill content that explains how to create skills.
 * This is returned dynamically when skills.mutable is true.
 */
const BUILTIN_CREATING_SKILLS_CONTENT = `---
name: creating-skills
description: Learn how to create and manage gateway skills
---

# Creating Gateway Skills

Gateway skills are reusable instruction sets that extend the gateway's capabilities. They provide specialized guidance for specific tasks and can include scripts and reference materials.

## Skill Structure

Each skill lives in its own directory under the skills folder:

\`\`\`
skills/
  my-skill/
    SKILL.md              # Required - main content with YAML frontmatter
    scripts/              # Optional - executable scripts
      extract.py
      process.sh
    references/           # Optional - reference documentation
      API.md
    assets/               # Optional - data files
      template.json
\`\`\`

## Creating a Skill

Use the \`write-gateway-skill\` tool to create or update skills:

\`\`\`lua
-- Create a simple skill
result(gateway.write_gateway_skill({
  skillName = "my-new-skill",
  content = [[---
name: My New Skill
description: What this skill does
---

# Instructions

Your skill instructions here...
]]
}):await())
\`\`\`

### Adding Resource Files

You can include scripts, references, or assets:

\`\`\`lua
result(gateway.write_gateway_skill({
  skillName = "data-processor",
  content = [[---
name: Data Processor
description: Process and transform data files
---

# Usage

Run the extract script to process data files.
]],
  files = {
    { path = "scripts/extract.py", content = "#!/usr/bin/env python3\\nprint('Processing...')" },
    { path = "references/FORMAT.md", content = "# Data Format\\n\\nExpected input format..." }
  }
}):await())
\`\`\`

## Loading Skills

Use \`load-gateway-skill\` to retrieve skill content:

\`\`\`lua
-- Load main skill content
local content = gateway.load_gateway_skill({ skillName = "my-skill" }):await()

-- Load a specific resource file
local script = gateway.load_gateway_skill({
  skillName = "my-skill",
  path = "scripts/extract.py"
}):await()
\`\`\`

## Running Scripts

Use \`invoke-gateway-skill-script\` to execute scripts from a skill:

\`\`\`lua
local result = gateway.invoke_gateway_skill_script({
  skillName = "data-processor",
  script = "extract.py",
  args = { "input.json", "--format", "csv" }
}):await()
\`\`\`

Scripts run with:
- Working directory set to the skill directory
- \`SKILL_DIR\` environment variable pointing to the skill directory
- Access to \`references/\` and \`assets/\` via relative paths

## YAML Frontmatter

Every SKILL.md must start with YAML frontmatter:

\`\`\`yaml
---
name: Human-Readable Name
description: Brief description of what the skill does
---
\`\`\`

- \`name\`: Displayed in skill listings (falls back to directory name if omitted)
- \`description\`: Shown in gateway instructions to help agents discover relevant skills

## Best Practices

1. **Clear naming**: Use kebab-case for skill directories (e.g., \`data-processor\`)
2. **Good descriptions**: Write descriptions that help agents find your skill
3. **Modular scripts**: Keep scripts focused and reusable
4. **Document formats**: Include reference docs for any custom formats or APIs
5. **Version control**: Skills persist locally - consider backing up important skills
`;

/**
 * Expected shape of skill frontmatter after YAML parsing.
 */
interface SkillFrontmatter {
  name?: string;
  description?: string;
}

@injectable()
export class SkillDiscoveryService implements ISkillDiscoveryService {
  private skillsCache: SkillMetadata[] | null = null;

  constructor(
    @$inject(TYPES.Logger) private logger: ILogger,
    @$inject(TYPES.ServerConfig) private config: ServerConfig,
  ) {}

  async discoverSkills(): Promise<SkillMetadata[]> {
    // Return cached results if available
    if (this.skillsCache !== null) {
      return this.skillsCache;
    }

    const skillsDir = getSkillsDir();
    const skills: SkillMetadata[] = [];

    // Include built-in creating-skills guide when skills are mutable
    if (this.config.skills?.mutable === true) {
      skills.push(BUILTIN_CREATING_SKILLS_METADATA);
      this.logger.debug("Added built-in 'creating-skills' skill");
    }

    // Check if skills directory exists
    if (!existsSync(skillsDir)) {
      this.logger.debug(`Skills directory does not exist: ${skillsDir}`);
      this.skillsCache = skills;
      return skills;
    }

    // Check if it's actually a directory
    try {
      const stats = statSync(skillsDir);
      if (!stats.isDirectory()) {
        this.logger.warn(
          `Skills path exists but is not a directory: ${skillsDir}`,
        );
        this.skillsCache = skills;
        return skills;
      }
    } catch {
      this.logger.warn(`Failed to stat skills directory: ${skillsDir}`);
      this.skillsCache = skills;
      return skills;
    }

    // Read directory entries
    let entries: string[];
    try {
      entries = readdirSync(skillsDir);
    } catch {
      this.logger.warn(`Failed to read skills directory: ${skillsDir}`);
      this.skillsCache = skills;
      return skills;
    }

    // Process each entry
    for (const entry of entries) {
      const entryPath = resolve(skillsDir, entry);

      // Skip non-directories
      try {
        const stats = statSync(entryPath);
        if (!stats.isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      // Check for SKILL.md
      const skillFilePath = resolve(entryPath, SKILL_FILENAME);
      if (!existsSync(skillFilePath)) {
        this.logger.debug(`Skipping directory without SKILL.md: ${entry}`);
        continue;
      }

      // Parse frontmatter
      const metadata = this.parseSkillMetadata(skillFilePath, entry);
      if (metadata) {
        skills.push(metadata);
        this.logger.debug(`Discovered skill: ${metadata.name}`);
      }
    }

    const diskSkillCount = this.config.skills?.mutable
      ? skills.length - 1
      : skills.length;
    this.logger.info(`Discovered ${diskSkillCount} skill(s) from disk`);
    this.skillsCache = skills;
    return skills;
  }

  async getSkillContent(skillName: string): Promise<string | null> {
    // Check for built-in creating-skills skill
    if (
      skillName === BUILTIN_CREATING_SKILLS_NAME &&
      this.config.skills?.mutable === true
    ) {
      return BUILTIN_CREATING_SKILLS_CONTENT;
    }

    // Ensure skills are discovered first
    const skills = await this.discoverSkills();

    // Find skill by name
    const skill = skills.find((s) => s.name === skillName);
    if (!skill || !skill.path) {
      return null;
    }

    // Read full content
    const skillFilePath = resolve(skill.path, SKILL_FILENAME);
    try {
      return readFileSync(skillFilePath, "utf-8");
    } catch (error) {
      this.logger.error(
        `Failed to read skill content: ${skillFilePath}`,
        error instanceof Error ? error : undefined,
      );
      return null;
    }
  }

  async getSkillResource(
    skillName: string,
    relativePath: string,
  ): Promise<string | null> {
    // Built-in skills don't have resources
    if (skillName === BUILTIN_CREATING_SKILLS_NAME) {
      return null;
    }

    // Ensure skills are discovered first
    const skills = await this.discoverSkills();

    // Find skill by name
    const skill = skills.find((s) => s.name === skillName);
    if (!skill || !skill.path) {
      return null;
    }

    // Resolve the full path and validate it stays within the skill directory
    const fullPath = resolve(skill.path, relativePath);

    // Security: Ensure the resolved path is within the skill directory
    // This prevents path traversal attacks like "../../../etc/passwd"
    // The path must start with skill.path + separator to be inside the directory
    if (!fullPath.startsWith(skill.path + sep)) {
      this.logger.warn(
        `Path traversal detected for skill '${skillName}': ${relativePath}`,
      );
      throw new Error(
        `Invalid path: '${relativePath}' - path must be within the skill directory`,
      );
    }

    // Read the resource file
    try {
      return readFileSync(fullPath, "utf-8");
    } catch {
      this.logger.debug(
        `Resource not found: ${fullPath} (skill: ${skillName}, path: ${relativePath})`,
      );
      return null;
    }
  }

  clearCache(): void {
    this.skillsCache = null;
    this.logger.debug("Skills cache cleared");
  }

  ensureSkillsDirectory(): void {
    const skillsDir = getSkillsDir();

    if (existsSync(skillsDir)) {
      this.logger.debug(`Skills directory already exists: ${skillsDir}`);
      return;
    }

    try {
      mkdirSync(skillsDir, { recursive: true });
      this.logger.info(`Created skills directory: ${skillsDir}`);
    } catch (error) {
      this.logger.warn(
        `Failed to create skills directory: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Parse YAML frontmatter from a SKILL.md file.
   * @param filePath - Path to the SKILL.md file
   * @param dirName - Directory name (used as fallback for skill name)
   * @returns SkillMetadata or null if parsing fails
   */
  private parseSkillMetadata(
    filePath: string,
    dirName: string,
  ): SkillMetadata | null {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      this.logger.warn(`Failed to read skill file: ${filePath}`);
      return null;
    }

    // Extract frontmatter
    const frontmatterMatch = content.match(FRONTMATTER_REGEX);
    if (!frontmatterMatch) {
      this.logger.warn(`No frontmatter found in skill: ${filePath}`);
      return null;
    }

    const frontmatterYaml = frontmatterMatch[1]!;

    // Parse YAML frontmatter
    let frontmatter: SkillFrontmatter;
    try {
      frontmatter = parseYaml(frontmatterYaml) as SkillFrontmatter;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Invalid YAML in skill frontmatter: ${filePath} - ${errorMessage}`,
      );
      return null;
    }

    // Handle case where YAML is empty or not an object
    if (!frontmatter || typeof frontmatter !== "object") {
      this.logger.warn(`Empty or invalid frontmatter in skill: ${filePath}`);
      return null;
    }

    // Extract name and description, with fallbacks
    const name =
      typeof frontmatter.name === "string" ? frontmatter.name : dirName;
    const description =
      typeof frontmatter.description === "string"
        ? frontmatter.description
        : "";

    if (!description) {
      this.logger.warn(`Skill '${name}' has no description`);
    }

    return {
      name,
      description,
      path: resolve(filePath, ".."), // Parent directory
    };
  }
}
