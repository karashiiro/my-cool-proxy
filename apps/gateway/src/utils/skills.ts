import { resolve } from "path";
import { getPlatformConfigDir } from "./config-paths.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";

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

export const SKILLS_REMINDER_CONTENT_BLOCK: TextContent = Object.freeze({
  type: "text",
  text: "\n\nNote: Gateway skills are enabled. Strongly consider checking for applicable skills before continuing with your task.",
});
