import { injectable } from "inversify";
import type {
  IExecutionLog,
  LuaExecution,
  LuaToolCall,
} from "../types/interfaces.js";

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

  markExecutionResult(): void {}

  logToolCall(): string {
    return "";
  }

  markToolCallError(): void {}

  markToolCallResult(): void {}

  getExecutions(): LuaExecution[] {
    return [];
  }

  getToolCalls(): LuaToolCall[] {
    return [];
  }

  getExecution(): LuaExecution | undefined {
    return undefined;
  }

  getAllExecutions(): LuaExecution[] {
    return [];
  }
}
