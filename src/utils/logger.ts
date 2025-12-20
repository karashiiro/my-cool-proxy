import { injectable } from "inversify";
import type { ILogger } from "../types/interfaces.js";

@injectable()
export class ConsoleLogger implements ILogger {
  info(message: string, meta?: unknown): void {
    console.error(`[INFO] ${message}`, meta || "");
  }

  error(message: string, error?: Error): void {
    console.error(`[ERROR] ${message}`, error || "");
  }

  debug(message: string, meta?: unknown): void {
    console.error(`[DEBUG] ${message}`, meta || "");
  }
}
