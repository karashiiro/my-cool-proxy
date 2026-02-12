/**
 * Extracts a user-friendly error message from an unknown error value.
 *
 * This centralizes the `error instanceof Error ? error.message : String(error)`
 * pattern used throughout the codebase to ensure consistent error message extraction.
 *
 * @param error - The error value to extract a message from, may be any type
 * @returns The error message string
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
