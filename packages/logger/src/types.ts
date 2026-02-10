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

/**
 * Valid log levels supported by pino.
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Configuration for console output stream.
 */
export interface ConsoleLogConfig {
  /** Log level for console output. Default: "info" */
  level?: LogLevel;
}

/**
 * Configuration for file output stream.
 */
export interface FileLogConfig {
  /** Log level for file output. Default: "trace" */
  level?: LogLevel;
  /** Full path to the log file. Required when file logging is enabled. */
  path: string;
}

/**
 * Logger configuration for multi-destination output.
 * Allows independent log level configuration for console and file outputs.
 */
export interface LoggerConfig {
  /** Console output configuration. Always outputs to stderr. */
  console?: ConsoleLogConfig;
  /** File output configuration. Writes JSON-formatted logs. */
  file?: FileLogConfig;
}
