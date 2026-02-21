import type {
  IExecutionLog,
  LuaExecution,
  LuaToolCall,
  ToolUsage,
} from "../types/interfaces.js";
import type { SQLiteDatabase } from "./sqlite-database.js";

// Re-export types for backward compatibility
export type { LuaExecution, LuaToolCall };

/**
 * Generate a unique ID with a timestamp prefix for chronological ordering.
 */
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * SQLite-backed execution log for Lua script executions and their tool calls.
 *
 * Records are stored in descending order by timestamp for efficient
 * retrieval of the most recent executions.
 *
 * NOT injectable - instantiated directly in index.ts alongside SQLiteDatabase.
 */
export class SQLiteExecutionLog implements IExecutionLog {
  constructor(private readonly db: SQLiteDatabase) {}

  /**
   * Log the start of a Lua script execution.
   * @param sessionId The session that triggered the execution
   * @param script The Lua script source code
   * @returns The generated execution ID for linking tool calls
   */
  logExecution(sessionId: string, script: string): string {
    const executionId = generateId();
    const now = Date.now();

    this.db
      .getDatabase()
      .prepare(
        `INSERT INTO lua_executions (execution_id, session_id, script, status, created_at)
         VALUES (?, ?, ?, 'success', ?)`,
      )
      .run(executionId, sessionId, script, now);

    return executionId;
  }

  /**
   * Mark an execution as failed with an error message.
   * @param executionId The execution to mark as failed
   * @param error The error message
   */
  markExecutionError(executionId: string, error: string): void {
    this.db
      .getDatabase()
      .prepare(
        `UPDATE lua_executions SET status = 'error', error = ? WHERE execution_id = ?`,
      )
      .run(error, executionId);
  }

  /**
   * Store the final result of a Lua script execution.
   * @param executionId The execution to update
   * @param result The JSON-serialized result value
   */
  markExecutionResult(executionId: string, result: string): void {
    this.db
      .getDatabase()
      .prepare(`UPDATE lua_executions SET result = ? WHERE execution_id = ?`)
      .run(result, executionId);
  }

  /**
   * Log a tool call made within a Lua script execution.
   * @param executionId The parent execution ID
   * @param serverName The MCP server name (original, not sanitized)
   * @param toolName The tool name (original, not sanitized)
   * @param args The tool call arguments (JSON-serialized)
   * @returns The generated call ID
   */
  logToolCall(
    executionId: string,
    serverName: string,
    toolName: string,
    args?: string,
  ): string {
    const callId = generateId();
    const now = Date.now();

    this.db
      .getDatabase()
      .prepare(
        `INSERT INTO lua_tool_calls (call_id, execution_id, server_name, tool_name, arguments, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'success', ?)`,
      )
      .run(callId, executionId, serverName, toolName, args ?? null, now);

    return callId;
  }

  /**
   * Mark a tool call as failed with an error message.
   * @param callId The tool call to mark as failed
   * @param error The error message
   */
  markToolCallError(callId: string, error: string): void {
    this.db
      .getDatabase()
      .prepare(
        `UPDATE lua_tool_calls SET status = 'error', error = ? WHERE call_id = ?`,
      )
      .run(error, callId);
  }

  /**
   * Store the result of a tool call.
   * @param callId The tool call to update
   * @param result The JSON-serialized result value
   */
  markToolCallResult(callId: string, result: string): void {
    this.db
      .getDatabase()
      .prepare(`UPDATE lua_tool_calls SET result = ? WHERE call_id = ?`)
      .run(result, callId);
  }

  /**
   * Get recent executions for a session, ordered by timestamp descending.
   * @param sessionId The session to query
   * @param limit Maximum number of executions to return (default 50)
   */
  getExecutions(sessionId: string, limit = 50): LuaExecution[] {
    return this.db
      .getDatabase()
      .prepare(
        `SELECT
           execution_id AS executionId,
           session_id AS sessionId,
           script,
           status,
           error,
           result,
           created_at AS createdAt
         FROM lua_executions
         WHERE session_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(sessionId, limit) as LuaExecution[];
  }

  /**
   * Get tool calls for an execution, ordered by timestamp descending.
   * @param executionId The execution to query
   */
  getToolCalls(executionId: string): LuaToolCall[] {
    return this.db
      .getDatabase()
      .prepare(
        `SELECT
           call_id AS callId,
           execution_id AS executionId,
           server_name AS serverName,
           tool_name AS toolName,
           arguments,
           status,
           error,
           result,
           created_at AS createdAt
         FROM lua_tool_calls
         WHERE execution_id = ?
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(executionId) as LuaToolCall[];
  }

  /**
   * Get a single execution by ID.
   * @param executionId The execution to retrieve
   */
  getExecution(executionId: string): LuaExecution | undefined {
    return this.db
      .getDatabase()
      .prepare(
        `SELECT
           execution_id AS executionId,
           session_id AS sessionId,
           script,
           status,
           error,
           result,
           created_at AS createdAt
         FROM lua_executions
         WHERE execution_id = ?`,
      )
      .get(executionId) as LuaExecution | undefined;
  }

  /**
   * Get recent executions across all sessions, ordered by timestamp descending.
   * @param limit Maximum number of executions to return (default 50)
   * @param offset Number of executions to skip (default 0)
   * @param toolFilter Optional "server.tool" string to filter by tool usage
   */
  getAllExecutions(limit = 50, offset = 0, toolFilter?: string): LuaExecution[] {
    if (toolFilter) {
      return this.db
        .getDatabase()
        .prepare(
          `SELECT DISTINCT
             e.execution_id AS executionId,
             e.session_id AS sessionId,
             e.script,
             e.status,
             e.error,
             e.result,
             e.created_at AS createdAt
           FROM lua_executions e
           INNER JOIN lua_tool_calls tc ON tc.execution_id = e.execution_id
           WHERE tc.server_name || '.' || tc.tool_name = ?
           ORDER BY e.created_at DESC, e.rowid DESC
           LIMIT ? OFFSET ?`,
        )
        .all(toolFilter, limit, offset) as LuaExecution[];
    }

    return this.db
      .getDatabase()
      .prepare(
        `SELECT
           execution_id AS executionId,
           session_id AS sessionId,
           script,
           status,
           error,
           result,
           created_at AS createdAt
         FROM lua_executions
         ORDER BY created_at DESC, rowid DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as LuaExecution[];
  }

  /**
   * Count total executions across all sessions.
   * @param toolFilter Optional "server.tool" string to filter by tool usage
   */
  countExecutions(toolFilter?: string): number {
    if (toolFilter) {
      const row = this.db
        .getDatabase()
        .prepare(
          `SELECT COUNT(DISTINCT e.execution_id) AS count
           FROM lua_executions e
           INNER JOIN lua_tool_calls tc ON tc.execution_id = e.execution_id
           WHERE tc.server_name || '.' || tc.tool_name = ?`,
        )
        .get(toolFilter) as { count: number } | undefined;
      return row?.count ?? 0;
    }

    const row = this.db
      .getDatabase()
      .prepare(`SELECT COUNT(*) AS count FROM lua_executions`)
      .get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /**
   * Get distinct tool names with usage counts, ordered by count descending.
   */
  getDistinctTools(): ToolUsage[] {
    return this.db
      .getDatabase()
      .prepare(
        `SELECT server_name || '.' || tool_name AS tool, COUNT(*) AS count
         FROM lua_tool_calls
         GROUP BY server_name, tool_name
         ORDER BY count DESC, tool ASC`,
      )
      .all() as ToolUsage[];
  }
}
