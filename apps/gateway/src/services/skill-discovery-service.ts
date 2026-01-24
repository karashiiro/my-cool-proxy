import { injectable } from "inversify";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { resolve, sep } from "path";
import { parse as parseYaml } from "yaml";
import type { ILogger } from "../types/interfaces.js";
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
 * Expected shape of skill frontmatter after YAML parsing.
 */
interface SkillFrontmatter {
  name?: string;
  description?: string;
}

@injectable()
export class SkillDiscoveryService implements ISkillDiscoveryService {
  private skillsCache: SkillMetadata[] | null = null;

  constructor(@$inject(TYPES.Logger) private logger: ILogger) {}

  async discoverSkills(): Promise<SkillMetadata[]> {
    // Return cached results if available
    if (this.skillsCache !== null) {
      return this.skillsCache;
    }

    const skillsDir = getSkillsDir();
    const skills: SkillMetadata[] = [];

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

    this.logger.info(`Discovered ${skills.length} skill(s)`);
    this.skillsCache = skills;
    return skills;
  }

  async getSkillContent(skillName: string): Promise<string | null> {
    // Ensure skills are discovered first
    const skills = await this.discoverSkills();

    // Find skill by name
    const skill = skills.find((s) => s.name === skillName);
    if (!skill) {
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
    // Ensure skills are discovered first
    const skills = await this.discoverSkills();

    // Find skill by name
    const skill = skills.find((s) => s.name === skillName);
    if (!skill) {
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
