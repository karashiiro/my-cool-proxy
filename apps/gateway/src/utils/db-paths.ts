import envPaths from "env-paths";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Disable the default "-nodejs" suffix to keep paths clean
const paths = envPaths("my-cool-proxy", { suffix: "" });

/**
 * Get the fixed database path for session persistence.
 * Uses platform-appropriate location:
 * - Linux: ~/.local/share/my-cool-proxy/sessions.db
 * - macOS: ~/Library/Application Support/my-cool-proxy/sessions.db
 * - Windows: %LOCALAPPDATA%\my-cool-proxy\Data\sessions.db
 */
export function getDbPath(): string {
  return `${paths.data}/sessions.db`;
}

/**
 * Ensure the database directory exists.
 * Creates the directory recursively if it doesn't exist.
 */
export function ensureDbDirectory(): void {
  const dbPath = getDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
}
