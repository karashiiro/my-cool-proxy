import { parse as parseYaml } from "yaml";

/**
 * Regular expression to extract YAML frontmatter from a markdown file.
 * Matches content between opening and closing `---` delimiters at the start of the file.
 */
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/**
 * Expected shape of skill frontmatter after YAML parsing.
 */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
}

export type ParseFrontmatterResult =
  | { ok: true; frontmatter: SkillFrontmatter }
  | { ok: false; error: string };

/**
 * Extract and parse YAML frontmatter from markdown content.
 * @param content - The full markdown content string
 * @returns A result object: `{ ok: true, frontmatter }` on success,
 *          `{ ok: false, error }` on failure (no delimiters, invalid YAML, empty, etc.)
 */
export function parseFrontmatter(content: string): ParseFrontmatterResult {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return { ok: false, error: "no_frontmatter" };
  }

  const frontmatterYaml = match[1]!;

  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatterYaml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Invalid YAML in frontmatter: ${message}` };
  }

  // Handle case where YAML is empty or not an object
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "empty_or_non_object" };
  }

  return { ok: true, frontmatter: parsed as SkillFrontmatter };
}
