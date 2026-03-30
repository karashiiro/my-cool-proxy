/**
 * Default session ID used when no explicit session is provided.
 */
export const DEFAULT_SESSION_ID = "default";

/**
 * Normalize a session ID, falling back to the default.
 */
export function normalizeSessionId(sessionId: string | undefined): string {
  return sessionId || DEFAULT_SESSION_ID;
}
