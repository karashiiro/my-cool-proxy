import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Create a temporary directory for an ACP session.
 * The directory is created with a unique name based on the session ID.
 *
 * @param sessionId - The session ID to use in the directory name
 * @returns The absolute path to the created temporary directory
 */
export function createSessionTempDir(sessionId: string): string {
  const prefix = join(tmpdir(), `mcp-gateway-${sessionId}-`);
  return mkdtempSync(prefix);
}

/**
 * Clean up a session temporary directory.
 * Removes the directory and all its contents recursively.
 * Errors are caught and ignored (best-effort cleanup).
 *
 * @param dir - The directory path to remove
 */
export function cleanupSessionTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Log but don't throw - cleanup is best-effort
    // The error will be handled by the caller if they need to log it
  }
}
