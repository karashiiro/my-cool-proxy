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
   * Get the full content of a skill by name.
   * @param skillName - The name of the skill to load
   * @returns Full SKILL.md content, or null if skill not found
   */
  getSkillContent(skillName: string): Promise<string | null>;
}
