import { injectable } from "inversify";
import { existsSync, mkdirSync } from "fs";
import type { Stats } from "node:fs";
import { readFile, readdir, stat, access } from "node:fs/promises";
import { resolve } from "path";
import { getErrorMessage } from "@my-cool-proxy/mcp-utilities";
import type { ILogger, ServerConfig } from "../types/interfaces.js";
import type { ISkillDiscoveryService, SkillMetadata } from "../types/skill.js";
import { getSkillsDir, SKILL_FILENAME } from "../utils/skills.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import { parseFrontmatter } from "./skill-frontmatter-parser.js";
import { resolveAndValidate } from "./path-validator.js";

/**
 * Built-in skill name for the skill creation guide.
 */
const BUILTIN_CREATING_SKILLS_NAME = "writing-gateway-skills";

/**
 * Built-in skill content that explains how to create skills.
 * This is returned dynamically when skills.mutable is true.
 */
const BUILTIN_CREATING_SKILLS_CONTENT = `---
name: ${BUILTIN_CREATING_SKILLS_NAME}
description: Use when asked to create, write, or save a gateway skill. Covers structure, patterns, and best practices.
---

# Writing Gateway Skills

## Overview

Use the \`_gateway.write_skill()\` Lua builtin to create skills. Skills extend agent capabilities with specialized knowledge, workflows, and tools.

NOTE: This skill is built into the MCP gateway. Do not attempt to modify it with \`_gateway.write_skill()\`.

## Core Principles

- **The context window is a public good.** Skills share it with the system prompt, conversation history, other skills' metadata, and the actual request.
- **The agent is already smart.** Only add context it doesn't already have. Challenge each piece: "Does this paragraph justify its token cost?" Prefer concise examples over verbose explanations.
- **Match specificity to task fragility.** Highly sensitive operations need exact instructions. Flexible tasks allow broader guidance. Think of it as a path: narrow bridge with cliffs needs guardrails (low freedom), open field allows many routes (high freedom).

## When to Create a Skill

Create a skill when:

- The task required techniques that are non-obvious or specialized.
- Repeatedly performing similar tasks that benefit from shared knowledge.
- Teammates will likely want to reuse the same methods or references.

Don't create a skill when:

- The technique is unlikely to be needed again.
- The required knowledge is trivial or well-documented elsewhere in the project.
- The context window cost outweighs the benefit.

### Skill Types

| Type | Purpose | Example |
|------|---------|---------|
| **Technique** | Concrete method with steps | PDF rotation, API pagination |
| **Pattern** | Mental model for problems | Progressive disclosure, error handling |
| **Reference** | API docs, syntax, specifications | MCP protocol, database schemas |

## Creation Process

1. **Gather examples**: Understand concrete use cases. Ask: "What would trigger this skill?"
2. **Plan resources**: For each example, identify reusable scripts/references/assets
3. **Write content**: Start with resources, then write SKILL.md referencing them in a scannable table
4. **Test**: Verify scripts work, examples are accurate

### Skill Structure

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
description: Use when [triggers/symptoms] - [what it does, third person]
---

# Skill Name

## Overview
Core principle in 1-2 sentences.

## When to Use
Symptoms and use cases. When NOT to use.

## Core Pattern
Before/after comparison or key technique.

## Quick Reference
Table or bullets for scanning.

## Common Mistakes
What goes wrong + fixes.
\`\`\`

**Frontmatter fields:**
- \`name\` (required): Lowercase + hyphens, matches skillName
- \`description\` (required): What AND when - this is how agents discover your skill

Keep SKILL.md under 500 lines. Use imperative form ("Run the script" not "You should run").

### Bundled Resources

**scripts/** - Executable code run via \`_gateway.invoke_skill_script()\`
- Use when: same code is repeatedly rewritten, deterministic reliability needed
- Example: \`scripts/rotate_pdf.py\` for PDF tasks

**references/** - Documentation loaded on-demand via \`_gateway.read_resource()\` with \`gw-skill://{name}/{path}\`
- Use when: detailed docs the agent should reference while working
- Examples: API specs, database schemas, domain knowledge
- For large files (>10k words): include grep patterns in SKILL.md

**assets/** - Files used in output, not loaded into context
- Use when: templates, images, boilerplate to copy/modify
- Examples: \`assets/logo.png\`, \`assets/template.html\`

## Common Mistakes

### What NOT to Include

Do NOT create extraneous files:
- README.md, INSTALLATION_GUIDE.md, CHANGELOG.md, etc.
- User-facing documentation
- Setup/testing procedures

Skills are for agents, not humans. Include only what helps an agent do the job.

### Anti-Patterns

| Pattern | Problem | Fix |
|---------|---------|-----|
| Narrative examples | "On 2025-01-15 we found..." - too specific | Use generic, reproducible examples |
| Multi-language dilution | example.js + example.py = maintenance burden | Pick ONE excellent example |
| Code in flowcharts | Can't copy-paste, hard to parse | Use code blocks |
| Generic labels | helper1, step3 - no semantic meaning | Use descriptive names |

## Testing Your Skill

Before deploying, verify the skill works in a subagent or test session:

1. **Baseline**: Try the task WITHOUT the skill - identify gaps
2. **With skill**: Load it and retry - verify it helps
3. **Edge cases**: Test uncommon scenarios
`;

/**
 * Built-in skill metadata for the skill creation guide.
 * This skill is virtual (not on disk) and only shown when skills.mutable is true.
 */
const BUILTIN_CREATING_SKILLS_METADATA: SkillMetadata = {
  name: BUILTIN_CREATING_SKILLS_NAME,
  description:
    "Use when asked to create, write, or save a gateway skill. Covers structure, patterns, and best practices.",
  path: "", // Virtual skill - no path on disk
  size: Buffer.byteLength(BUILTIN_CREATING_SKILLS_CONTENT, "utf-8"),
};

@injectable()
export class SkillDiscoveryService implements ISkillDiscoveryService {
  constructor(
    @$inject(TYPES.Logger) private logger: ILogger,
    @$inject(TYPES.ServerConfig) private config: ServerConfig,
  ) {}

  async discoverSkills(): Promise<SkillMetadata[]> {
    const skillsDir = getSkillsDir();
    const skills: SkillMetadata[] = [];

    // Include built-in writing-gateway-skills guide when skills are mutable
    if (this.config.skills?.mutable === true) {
      skills.push(BUILTIN_CREATING_SKILLS_METADATA);
      this.logger.debug(
        `Added built-in '${BUILTIN_CREATING_SKILLS_NAME}' skill`,
      );
    }

    // Check if skills directory exists
    if (!existsSync(skillsDir)) {
      this.logger.debug(`Skills directory does not exist: ${skillsDir}`);
      return skills;
    }

    // Check if it's actually a directory
    try {
      const stats = await stat(skillsDir);
      if (!stats.isDirectory()) {
        this.logger.warn(
          `Skills path exists but is not a directory: ${skillsDir}`,
        );
        return skills;
      }
    } catch {
      this.logger.warn(`Failed to stat skills directory: ${skillsDir}`);
      return skills;
    }

    // Read directory entries
    let entries: string[];
    try {
      entries = await readdir(skillsDir);
    } catch {
      this.logger.warn(`Failed to read skills directory: ${skillsDir}`);
      return skills;
    }

    // Process each entry
    for (const entry of entries) {
      const entryPath = resolve(skillsDir, entry);

      // Skip non-directories
      try {
        const stats = await stat(entryPath);
        if (!stats.isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      // Check for SKILL.md
      const skillFilePath = resolve(entryPath, SKILL_FILENAME);
      try {
        await access(skillFilePath);
      } catch {
        this.logger.debug(`Skipping directory without SKILL.md: ${entry}`);
        continue;
      }

      // Parse frontmatter
      const metadata = await this.parseSkillMetadata(skillFilePath, entry);
      if (metadata) {
        skills.push(metadata);
        this.logger.debug(`Discovered skill: ${metadata.name}`);
      }
    }

    const diskSkillCount = this.config.skills?.mutable
      ? skills.length - 1
      : skills.length;
    this.logger.info(`Discovered ${diskSkillCount} skill(s) from disk`);
    return skills;
  }

  async getSkillContent(skillName: string): Promise<string | null> {
    // Check for built-in writing-gateway-skills skill
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
      return await readFile(skillFilePath, "utf-8");
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
    let fullPath: string;
    try {
      fullPath = resolveAndValidate(skill.path, relativePath);
    } catch {
      this.logger.warn(
        `Path traversal detected for skill '${skillName}': ${relativePath}`,
      );
      throw new Error(
        `Invalid path: '${relativePath}' - path must be within the skill directory`,
      );
    }

    // Read the resource file
    try {
      return await readFile(fullPath, "utf-8");
    } catch {
      this.logger.debug(
        `Resource not found: ${fullPath} (skill: ${skillName}, path: ${relativePath})`,
      );
      return null;
    }
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
        `Failed to create skills directory: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Parse YAML frontmatter from a SKILL.md file.
   * @param filePath - Path to the SKILL.md file
   * @param dirName - Directory name (used as fallback for skill name)
   * @returns SkillMetadata or null if parsing fails
   */
  private async parseSkillMetadata(
    filePath: string,
    dirName: string,
  ): Promise<SkillMetadata | null> {
    let content: string;
    let fileStats: Stats;
    try {
      [content, fileStats] = await Promise.all([
        readFile(filePath, "utf-8"),
        stat(filePath),
      ]);
    } catch {
      this.logger.warn(`Failed to read skill file: ${filePath}`);
      return null;
    }

    // Extract and parse frontmatter
    const result = parseFrontmatter(content);
    if (!result.ok) {
      this.logger.warn(
        `Invalid or missing frontmatter in skill: ${filePath} - ${result.error}`,
      );
      return null;
    }

    const { frontmatter } = result;

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
      size: fileStats.size,
      lastModified: fileStats.mtime.toISOString(),
    };
  }
}
