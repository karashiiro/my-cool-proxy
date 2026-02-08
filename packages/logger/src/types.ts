/**
 * Canonical logger interface used across all workspace packages.
 * This is the single source of truth — all packages re-export from here.
 */
export interface ILogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: Error): void;
  debug(message: string): void;
}
