// =============================================================================
// Skill URI Utilities
// =============================================================================

/**
 * URI scheme prefix for skill resources.
 */
export const SKILL_URI_SCHEME = "gw-skill://";

/**
 * Create a skill resource URI.
 *
 * @param skillName - The name of the skill
 * @param path - Optional relative path to a resource within the skill (e.g., "scripts/rotate.py")
 * @returns The skill URI in format: gw-skill://{skillName} or gw-skill://{skillName}/{path}
 *
 * @example
 * createSkillResourceUri("pdf-rotation")
 * // Returns: "gw-skill://pdf-rotation"
 *
 * @example
 * createSkillResourceUri("pdf-rotation", "scripts/rotate.py")
 * // Returns: "gw-skill://pdf-rotation/scripts/rotate.py"
 */
export function createSkillResourceUri(
  skillName: string,
  path?: string,
): string {
  if (path) {
    return `${SKILL_URI_SCHEME}${skillName}/${path}`;
  }
  return `${SKILL_URI_SCHEME}${skillName}`;
}

/**
 * Parse a skill resource URI back to its components.
 *
 * @param uri - The skill URI to parse
 * @returns Object with skillName and optional path, or null if format is invalid
 *
 * @example
 * parseSkillResourceUri("gw-skill://pdf-rotation")
 * // Returns: { skillName: "pdf-rotation" }
 *
 * @example
 * parseSkillResourceUri("gw-skill://pdf-rotation/scripts/rotate.py")
 * // Returns: { skillName: "pdf-rotation", path: "scripts/rotate.py" }
 *
 * @example
 * parseSkillResourceUri("file:///some/resource")
 * // Returns: null (not a skill URI)
 */
export function parseSkillResourceUri(
  uri: string,
): { skillName: string; path?: string } | null {
  if (!uri.startsWith(SKILL_URI_SCHEME)) {
    return null;
  }

  // Remove the "gw-skill://" prefix
  const withoutScheme = uri.slice(SKILL_URI_SCHEME.length);

  if (!withoutScheme) {
    return null;
  }

  // Find the first "/" to split skill name from path
  const firstSlashIndex = withoutScheme.indexOf("/");

  if (firstSlashIndex === -1) {
    // No path, just skill name
    return { skillName: withoutScheme };
  }

  const skillName = withoutScheme.slice(0, firstSlashIndex);
  const path = withoutScheme.slice(firstSlashIndex + 1);

  if (!skillName) {
    return null;
  }

  // Return path only if it's non-empty
  if (path) {
    return { skillName, path };
  }

  return { skillName };
}

/**
 * Check if a URI is a skill resource URI.
 *
 * @param uri - The URI to check
 * @returns true if the URI starts with "gw-skill://"
 *
 * @example
 * isSkillResourceUri("gw-skill://pdf-rotation")
 * // Returns: true
 *
 * @example
 * isSkillResourceUri("file:///some/resource")
 * // Returns: false
 */
export function isSkillResourceUri(uri: string): boolean {
  return uri.startsWith(SKILL_URI_SCHEME);
}
