import { injectable } from "inversify";
import type { IExecutionLog } from "../types/interfaces.js";

/**
 * No-op execution log used when SQLite persistence is not available (stdio mode).
 * All methods are stubs that return placeholder values.
 */
@injectable()
export class NoopExecutionLog implements IExecutionLog {
  logExecution(): string {
    return "";
  }

  markExecutionError(): void {}

  logToolCall(): string {
    return "";
  }

  markToolCallError(): void {}
}
