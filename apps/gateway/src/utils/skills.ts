import { resolve } from "path";
import { getActiveConfigDir } from "./config-paths.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";

export const SKILLS_DIRNAME = "skills";
export const SKILL_FILENAME = "SKILL.md";

/**
 * Get the skills directory, respecting CONFIG_PATH if set.
 * Skills are stored in a 'skills' subdirectory of the config directory.
 *
 * Example paths (when CONFIG_PATH not set):
 * - macOS: ~/Library/Application Support/my-cool-proxy/skills
 * - Linux: ~/.config/my-cool-proxy/skills
 * - Windows: %APPDATA%\my-cool-proxy\skills
 *
 * When CONFIG_PATH is set, skills are in {CONFIG_PATH parent}/skills
 */
export function getSkillsDir(): string {
  return resolve(getActiveConfigDir(), SKILLS_DIRNAME);
}

export const SKILLS_REMINDER_CONTENT_BLOCK: TextContent = Object.freeze({
  type: "text",
  text: "\n\nNote: Gateway skills are enabled. Check for applicable skills before continuing with your task.",
});
