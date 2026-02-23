/**
 * Shared utilities for SQLite-backed stores.
 */

/**
 * Generate a time-based unique ID for store records.
 * Format: {timestamp}_{random} — matches InMemoryEventStore format.
 */
export function generateTimeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Execute a SQLite operation with error handling.
 * Catches better-sqlite3 errors and wraps them with context.
 */
export function safeExecute<T>(operation: () => T, context: string): T {
  try {
    return operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`SQLite error in ${context}: ${message}`);
  }
}
