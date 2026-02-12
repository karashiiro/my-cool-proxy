/**
 * Default session ID used when no explicit session is provided.
 * This is used in HTTP mode for clients that don't specify a session.
 */
export const DEFAULT_SESSION_ID = "default";

/**
 * Returns the effective session ID, defaulting to DEFAULT_SESSION_ID if not provided.
 *
 * This centralizes the `sessionId || "default"` pattern used throughout the codebase
 * to ensure consistent session handling across all tools and services.
 *
 * @param sessionId - The session ID provided by the client, may be undefined
 * @returns The effective session ID to use
 */
export function getEffectiveSessionId(sessionId: string | undefined): string {
  return sessionId || DEFAULT_SESSION_ID;
}
