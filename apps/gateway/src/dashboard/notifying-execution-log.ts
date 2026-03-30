import type {
  IExecutionLog,
  LuaExecution,
  LuaToolCall,
  ToolUsage,
} from "../types/interfaces.js";
import type { DashboardEvent } from "./types.js";

/**
 * Decorator around IExecutionLog that fires DashboardEvents for write operations.
 * Read and tool-call methods are delegated directly without emitting events.
 */
export class NotifyingExecutionLog implements IExecutionLog {
  constructor(
    private readonly inner: IExecutionLog,
    private readonly onEvent: (event: DashboardEvent) => void,
  ) {}

  logExecution(sessionId: string, script: string): string {
    const executionId = this.inner.logExecution(sessionId, script);
    try {
      this.onEvent({
        type: "execution:new",
        executionId,
        sessionId,
        createdAt: Date.now(),
      });
    } catch {
      // Broadcast failure must not affect execution logging
    }
    return executionId;
  }

  markExecutionResult(executionId: string, result: string): void {
    this.inner.markExecutionResult(executionId, result);
    try {
      this.onEvent({
        type: "execution:completed",
        executionId,
        status: "success",
      });
    } catch {
      // Broadcast failure must not affect execution logging
    }
  }

  markExecutionError(executionId: string, error: string): void {
    this.inner.markExecutionError(executionId, error);
    try {
      this.onEvent({
        type: "execution:completed",
        executionId,
        status: "error",
      });
    } catch {
      // Broadcast failure must not affect execution logging
    }
  }

  logToolCall(
    executionId: string,
    serverName: string,
    toolName: string,
    args?: string,
  ): string {
    return this.inner.logToolCall(executionId, serverName, toolName, args);
  }

  markToolCallResult(callId: string, result: string): void {
    this.inner.markToolCallResult(callId, result);
  }

  markToolCallError(callId: string, error: string): void {
    this.inner.markToolCallError(callId, error);
  }

  getExecutionResult(executionId: string): string | undefined {
    return this.inner.getExecutionResult(executionId);
  }

  getExecution(executionId: string): LuaExecution | undefined {
    return this.inner.getExecution(executionId);
  }

  getExecutions(sessionId: string, limit?: number): LuaExecution[] {
    return this.inner.getExecutions(sessionId, limit);
  }

  getToolCalls(executionId: string): LuaToolCall[] {
    return this.inner.getToolCalls(executionId);
  }

  getAllExecutions(
    limit?: number,
    offset?: number,
    toolFilter?: string,
  ): LuaExecution[] {
    return this.inner.getAllExecutions(limit, offset, toolFilter);
  }

  countExecutions(toolFilter?: string): number {
    return this.inner.countExecutions(toolFilter);
  }

  getDistinctTools(): ToolUsage[] {
    return this.inner.getDistinctTools();
  }
}
