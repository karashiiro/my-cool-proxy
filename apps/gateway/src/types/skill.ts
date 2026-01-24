/**
 * Metadata about a skill, extracted from SKILL.md frontmatter.
 * Used for displaying available skills without loading full content.
 */
export interface SkillMetadata {
  /** Human-readable skill name from frontmatter */
  name: string;
  /** Brief description of what the skill does */
  description: string;
  /** Full path to the skill directory */
  path: string;
}

/**
 * Service for discovering and loading skills from the skills directory.
 */
export interface ISkillDiscoveryService {
  /**
   * Discover all skills in the skills directory.
   * Parses YAML frontmatter from each SKILL.md to extract metadata.
   * @returns Array of skill metadata, or empty array if no skills found
   */
  discoverSkills(): Promise<SkillMetadata[]>;

  /**
   * Get the full content of a skill's SKILL.md by name.
   * @param skillName - The name of the skill to load
   * @returns Full SKILL.md content, or null if skill not found
   */
  getSkillContent(skillName: string): Promise<string | null>;

  /**
   * Get the content of a resource file within a skill directory.
   * Used for accessing scripts/, references/, and assets/ files.
   * @param skillName - The name of the skill
   * @param relativePath - Path relative to skill directory (e.g., "scripts/extract.py")
   * @returns File content, or null if skill or file not found
   * @throws Error if path traversal is detected
   */
  getSkillResource(
    skillName: string,
    relativePath: string,
  ): Promise<string | null>;

  /**
   * Clear the internal skills cache.
   * Call this after creating or modifying skills to ensure fresh discovery.
   */
  clearCache(): void;

  /**
   * Ensure default skills exist.
   * Creates built-in skills (like the skill creation guide) if they don't already exist.
   * Should be called once at startup before discovering skills.
   */
  ensureDefaultSkills(): Promise<void>;
}
