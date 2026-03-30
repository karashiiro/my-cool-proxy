import type { ILogger, LoggerConfig, LogLevel } from "./types.js";
import pino from "pino";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createWriteStream } from "node:fs";
import pretty from "pino-pretty";

/** Numeric log levels in pino - lower is more verbose */
const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Get the minimum (most verbose) log level from a list of levels.
 */
function getMinLevel(...levels: LogLevel[]): LogLevel {
  let minLevel: LogLevel = "fatal";
  let minValue = LOG_LEVEL_VALUES.fatal;

  for (const level of levels) {
    const value = LOG_LEVEL_VALUES[level];
    if (value < minValue) {
      minValue = value;
      minLevel = level;
    }
  }

  return minLevel;
}

/**
 * Logger implementation backed by pino.
 * Outputs all log messages to stderr so stdout remains clean for
 * protocol communication (e.g. MCP stdio transport).
 *
 * When configured with file output, logs are written to both:
 * - Console (stderr): Human-readable format via pino-pretty
 * - File: JSON format for machine parsing
 *
 * Note: This class is intentionally NOT decorated with @injectable()
 * to keep the logger package DI-framework-agnostic. The gateway app
 * wires it into Inversify via toDynamicValue() in its container config.
 */
export class ConsoleLogger implements ILogger {
  private logger: pino.Logger;

  constructor(config?: LoggerConfig) {
    if (config?.file) {
      // Multi-stream mode: console + file
      this.logger = this.createMultiStreamLogger(config);
    } else {
      // Console-only mode (original behavior)
      this.logger = this.createConsoleOnlyLogger(config?.console?.level);
    }
  }

  /**
   * Create a console-only logger using pino-pretty transport.
   * This is the original behavior when no file config is provided.
   */
  private createConsoleOnlyLogger(level?: LogLevel): pino.Logger {
    return pino({
      level: level ?? "debug",
      transport: {
        target: "pino-pretty",
        options: {
          destination: 2, // Output to stderr (2) instead of stdout (1)
        },
      },
    });
  }

  /**
   * Create a multi-stream logger with both console and file output.
   * Uses pino.multistream() to send logs to multiple destinations
   * with independent log levels for each.
   */
  private createMultiStreamLogger(config: LoggerConfig): pino.Logger {
    const consoleLevel = config.console?.level ?? "info";
    const fileLevel = config.file?.level ?? "trace";
    if (!config.file) {
      throw new Error("createMultiStreamLogger called without file config");
    }
    const filePath = config.file.path;

    // Ensure parent directory exists for log file
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });

    // Create streams with their respective levels
    const streams: pino.StreamEntry[] = [
      // Console stream: pino-pretty to stderr
      {
        level: consoleLevel,
        stream: pretty({
          destination: 2, // stderr
        }),
      },
      // File stream: JSON to file
      {
        level: fileLevel,
        stream: createWriteStream(filePath, { flags: "a" }),
      },
    ];

    // Base logger level must be the minimum of all stream levels
    // so that messages are available for the most verbose stream
    const baseLevel = getMinLevel(consoleLevel, fileLevel);

    return pino(
      {
        level: baseLevel,
      },
      pino.multistream(streams),
    );
  }

  info(msgOrObj: string | object, message?: string): void {
    if (typeof msgOrObj === "string") {
      this.logger.info(msgOrObj);
    } else {
      this.logger.info(msgOrObj, message ?? "");
    }
  }

  warn(msgOrObj: string | object, message?: string): void {
    if (typeof msgOrObj === "string") {
      this.logger.warn(msgOrObj);
    } else {
      this.logger.warn(msgOrObj, message ?? "");
    }
  }

  error(
    msgOrObj: string | object | Error,
    messageOrError?: string | Error,
  ): void {
    if (typeof msgOrObj === "string") {
      // error(message) or error(message, error)
      if (messageOrError instanceof Error) {
        this.logger.error(messageOrError, msgOrObj);
      } else {
        this.logger.error(msgOrObj);
      }
    } else if (msgOrObj instanceof Error) {
      // error(Error)
      this.logger.error(msgOrObj);
    } else {
      // error(obj, message)
      this.logger.error(msgOrObj, messageOrError as string);
    }
  }

  debug(msgOrObj: string | object, message?: string): void {
    if (typeof msgOrObj === "string") {
      this.logger.debug(msgOrObj);
    } else {
      this.logger.debug(msgOrObj, message ?? "");
    }
  }

  fatal(msgOrObj: string | object, message?: string): void {
    if (typeof msgOrObj === "string") {
      this.logger.fatal(msgOrObj);
    } else {
      this.logger.fatal(msgOrObj, message ?? "");
    }
  }
}
