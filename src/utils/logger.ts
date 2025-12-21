import { injectable } from "inversify";
import type { ILogger } from "../types/interfaces.js";
import pino from "pino";

@injectable()
export class ConsoleLogger implements ILogger {
  private logger = pino({
    transport: {
      target: "pino-pretty",
    },
  });

  info(message: string): void {
    this.logger.info(message);
  }

  error(msgOrErr: string | Error, error?: Error): void {
    if (typeof msgOrErr === "string") {
      if (error) {
        this.logger.error(error, msgOrErr);
      } else {
        this.logger.error(msgOrErr);
      }
    }
  }

  debug(message: string): void {
    this.logger.debug(message);
  }
}
