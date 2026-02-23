/* eslint-disable @typescript-eslint/no-unused-vars */
/* This is a no-op implementation of the execution log for tests, so the unused arguments are acceptable. */
import { injectable } from "inversify";
import type {
  IExecutionLog,
  LuaExecution,
  LuaToolCall,
  ToolUsage,
} from "../types/interfaces.js";

/**
 * No-op execution log used when SQLite persistence is not available.
 * All methods are stubs that return placeholder values.
 */
@injectable()
export class NoopExecutionLog implements IExecutionLog {
  logExecution(_sessionId: string, _script: string): string {
    return "";
  }

  markExecutionError(_executionId: string, _error: string): void {}

  markExecutionResult(_executionId: string, _result: string): void {}

  logToolCall(
    _executionId: string,
    _serverName: string,
    _toolName: string,
    _args?: string,
  ): string {
    return "";
  }

  markToolCallError(_callId: string, _error: string): void {}

  markToolCallResult(_callId: string, _result: string): void {}

  getExecutions(_sessionId: string, _limit?: number): LuaExecution[] {
    return [];
  }

  getToolCalls(_executionId: string): LuaToolCall[] {
    return [];
  }

  getExecution(_executionId: string): LuaExecution | undefined {
    return undefined;
  }

  getAllExecutions(
    _limit?: number,
    _offset?: number,
    _toolFilter?: string,
  ): LuaExecution[] {
    return [];
  }

  countExecutions(_toolFilter?: string): number {
    return 0;
  }

  getDistinctTools(): ToolUsage[] {
    return [];
  }
}
