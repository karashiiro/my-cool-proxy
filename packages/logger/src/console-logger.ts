import type { ILogger } from "./types.js";
import pino from "pino";

/**
 * Logger implementation backed by pino.
 * Outputs all log messages to stderr so stdout remains clean for
 * protocol communication (e.g. MCP stdio transport).
 *
 * Note: This class is intentionally NOT decorated with @injectable()
 * to keep the logger package DI-framework-agnostic. The gateway app
 * wires it into Inversify via toDynamicValue() in its container config.
 */
export class ConsoleLogger implements ILogger {
  private logger = pino({
    level: "debug",
    transport: {
      target: "pino-pretty",
      options: {
        destination: 2, // Output to stderr (2) instead of stdout (1)
      },
    },
  });

  info(message: string): void {
    this.logger.info(message);
  }

  warn(message: string): void {
    this.logger.warn(message);
  }

  error(msgOrErr: string | Error, error?: Error): void {
    if (typeof msgOrErr === "string") {
      if (error) {
        this.logger.error(error, msgOrErr);
      } else {
        this.logger.error(msgOrErr);
      }
    } else {
      this.logger.error(msgOrErr);
    }
  }

  debug(message: string): void {
    this.logger.debug(message);
  }
}
