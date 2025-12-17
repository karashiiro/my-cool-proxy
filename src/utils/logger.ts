import { injectable } from "inversify";
import type { ILogger } from "../types/interfaces.js";

@injectable()
export class ConsoleLogger implements ILogger {
  info(message: string, meta?: unknown): void {
    console.log(`[INFO] ${message}`, meta || "");
  }

  error(message: string, error?: Error): void {
    console.error(`[ERROR] ${message}`, error || "");
  }

  debug(message: string, meta?: unknown): void {
    console.debug(`[DEBUG] ${message}`, meta || "");
  }
}
