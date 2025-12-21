import { injectable } from "inversify";
import type { ILogger } from "../types/interfaces.js";
import winston from "winston";

const logFormat = winston.format.printf(function (info) {
  return `[${info.level}] ${info.message}`;
});

@injectable()
export class ConsoleLogger implements ILogger {
  private logger = winston.createLogger({
    defaultMeta: { service: "my-cool-proxy" },
    transports: [
      new winston.transports.Console({
        level: "debug",
        format: winston.format.combine(winston.format.colorize(), logFormat),
      }),
    ],
  });

  info(message: string): void {
    this.logger.info(message);
  }

  error(msgOrErr: string | Error, error?: Error): void {
    if (typeof msgOrErr === "string") {
      if (error) {
        this.logger.error(msgOrErr, { error });
      } else {
        this.logger.error(msgOrErr);
      }
    } else {
      this.logger.error(msgOrErr.message, {
        error: msgOrErr.stack || msgOrErr.message,
      });
    }
  }

  debug(message: string): void {
    this.logger.debug(message);
  }
}
