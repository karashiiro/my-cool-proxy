import { resolve } from "path";
import { getPlatformConfigDir } from "./config-paths.js";

export const SKILLS_DIRNAME = "skills";
export const SKILL_FILENAME = "SKILL.md";

/**
 * Get the platform-specific skills directory.
 * Skills are stored in a 'skills' subdirectory of the config directory.
 *
 * Example paths:
 * - macOS: ~/Library/Application Support/my-cool-proxy/skills
 * - Linux: ~/.config/my-cool-proxy/skills
 * - Windows: %APPDATA%\my-cool-proxy\skills
 */
export function getSkillsDir(): string {
  return resolve(getPlatformConfigDir(), SKILLS_DIRNAME);
}
