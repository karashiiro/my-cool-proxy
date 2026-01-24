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
  description:
    "Author new gateway skills. Use when asked to create, write, or save a skill.",
  path: "", // Virtual skill - no path on disk
};

/**
 * Built-in skill content that explains how to create skills.
 * This is returned dynamically when skills.mutable is true.
 */
const BUILTIN_CREATING_SKILLS_CONTENT = `---
name: creating-skills
description: Author new gateway skills. Use when asked to create, write, or save a skill.
---

# Creating Gateway Skills

Use \`write-gateway-skill\` to create skills. Skills extend agent capabilities with specialized knowledge, workflows, and tools.

## Core Principles

### Concise is Key

The context window is a public good. Skills share it with the system prompt, conversation history, other skills' metadata, and the actual request.

**Default assumption: the agent is already smart.** Only add context it doesn't already have. Challenge each piece: "Does this paragraph justify its token cost?" Prefer concise examples over verbose explanations.

### Degrees of Freedom

Match specificity to task fragility:

| Freedom | When to use | Format |
|---------|-------------|--------|
| **High** | Multiple approaches valid, context-dependent | Text instructions, heuristics |
| **Medium** | Preferred pattern exists, some variation OK | Pseudocode, parameterized scripts |
| **Low** | Operations are fragile, consistency critical | Specific scripts, few parameters |

Think of it as a path: narrow bridge with cliffs needs guardrails (low freedom), open field allows many routes (high freedom).

## Skill Structure

\`\`\`
skill-name/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Optional: executable code
├── references/           # Optional: docs loaded on-demand
└── assets/               # Optional: templates, static files
\`\`\`

### SKILL.md Format

\`\`\`yaml
---
name: my-skill-name
description: What this does and WHEN to use it. Include trigger keywords.
---

# Instructions here
\`\`\`

**Frontmatter fields:**
- \`name\` (required): Lowercase + hyphens, matches skillName
- \`description\` (required): What AND when - this is how agents discover your skill

Keep SKILL.md under 500 lines. Use imperative form ("Run the script" not "You should run").

### Bundled Resources

**scripts/** - Executable code run via \`invoke-gateway-skill-script\`
- Use when: same code is repeatedly rewritten, deterministic reliability needed
- Example: \`scripts/rotate_pdf.py\` for PDF tasks

**references/** - Documentation loaded on-demand via \`load-gateway-skill\` with path parameter
- Use when: detailed docs the agent should reference while working
- Examples: API specs, database schemas, domain knowledge
- For large files (>10k words): include grep patterns in SKILL.md

**assets/** - Files used in output, not loaded into context
- Use when: templates, images, boilerplate to copy/modify
- Examples: \`assets/logo.png\`, \`assets/template.html\`

## Progressive Disclosure

Skills load in three stages to manage context:

1. **Metadata** (~100 tokens) - Always loaded: \`name\` + \`description\`
2. **SKILL.md body** (<5k tokens) - When skill triggers
3. **Resources** (unlimited) - Only when explicitly requested

### Disclosure Patterns

**Pattern 1: High-level with references**
\`\`\`markdown
## Quick start
[Core example here]

## Advanced
- **Forms**: See references/FORMS.md
- **API reference**: See references/API.md
\`\`\`

**Pattern 2: Domain organization**
\`\`\`
analytics-skill/
├── SKILL.md (overview + navigation)
└── references/
    ├── finance.md
    ├── sales.md
    └── product.md
\`\`\`
Agent only loads the relevant domain file.

**Pattern 3: Framework variants**
\`\`\`
deploy-skill/
├── SKILL.md (workflow + selection guide)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
\`\`\`

## What NOT to Include

Do NOT create extraneous files:
- README.md, INSTALLATION_GUIDE.md, CHANGELOG.md, etc.
- User-facing documentation
- Setup/testing procedures

Skills are for agents, not humans. Include only what helps an agent do the job.

## Creation Process

1. **Gather examples**: Understand concrete use cases. Ask: "What would trigger this skill?"
2. **Plan resources**: For each example, identify reusable scripts/references/assets
3. **Write content**: Start with resources, then write SKILL.md referencing them
4. **Test**: Verify scripts work, examples are accurate

## Example

\`\`\`yaml
---
name: code-review
description: Review code for bugs, security, and style. Use when asked to review, audit, or check code quality.
---

# Code Review

1. Identify files to review
2. Check: security vulnerabilities, error handling, edge cases, style
3. Provide actionable feedback with line references

For detailed checklist: See references/CHECKLIST.md
\`\`\`
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
