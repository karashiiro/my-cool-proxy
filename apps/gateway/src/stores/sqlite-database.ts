import Database from "better-sqlite3";

/**
 * SQLite database wrapper for session persistence.
 * Manages the database connection and schema initialization.
 *
 * NOT injectable - instantiated directly in index.ts for HTTP mode.
 */
export class SQLiteDatabase {
  private db: Database.Database;

  /**
   * Create a new SQLite database connection.
   * @param dbPath Path to the SQLite database file, or ":memory:" for in-memory
   */
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    // Enable WAL mode for better concurrent access
    this.db.pragma("journal_mode = WAL");
    this.initializeSchema();
  }

  /**
   * Initialize the database schema.
   * Creates tables if they don't exist.
   */
  private initializeSchema(): void {
    // Events table for SSE resumability
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_events (
        event_id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_stream ON mcp_events(session_id, stream_id, event_id);
      CREATE INDEX IF NOT EXISTS idx_session_created ON mcp_events(session_id, created_at);
    `);

    // Sessions table for capability persistence
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        capabilities TEXT,
        working_directory TEXT,
        created_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL
      );
    `);

    // Session init requests table for session restoration
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_init_requests (
        session_id TEXT PRIMARY KEY,
        request TEXT NOT NULL
      );
    `);

    // Lua execution log table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lua_executions (
        execution_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        script TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        result TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lua_executions_session_created
        ON lua_executions(session_id, created_at DESC);
    `);

    // Tool calls within Lua executions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lua_tool_calls (
        call_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES lua_executions(execution_id),
        server_name TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        arguments TEXT,
        status TEXT NOT NULL,
        error TEXT,
        result TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lua_tool_calls_execution
        ON lua_tool_calls(execution_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lua_tool_calls_tool
        ON lua_tool_calls(server_name, tool_name);
    `);
  }

  /**
   * Get the underlying better-sqlite3 database instance.
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * Get session timestamps for the given session IDs.
   * Returns only rows that exist in the sessions table.
   *
   * @param sessionIds Array of session IDs to look up
   * @returns Array of objects with session_id, created_at, and last_activity
   */
  getSessionTimestamps(sessionIds: string[]): Array<{
    session_id: string;
    created_at: number;
    last_activity: number;
  }> {
    if (sessionIds.length === 0) {
      return [];
    }
    const placeholders = sessionIds.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT session_id, created_at, last_activity FROM sessions WHERE session_id IN (${placeholders})`,
      )
      .all(...sessionIds) as Array<{
      session_id: string;
      created_at: number;
      last_activity: number;
    }>;
  }

  /**
   * Run a function within a transaction.
   * @param fn Function to run within the transaction
   * @returns The return value of the function
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Purge data older than the specified retention period.
   * Runs within a transaction for consistency.
   *
   * @param retentionDays Number of days of data to retain
   * @returns Object with the number of rows deleted from each table
   */
  purgeOldData(retentionDays: number): {
    luaToolCalls: number;
    luaExecutions: number;
    mcpEvents: number;
    sessionInitRequests: number;
    sessions: number;
  } {
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    return this.transaction(() => {
      // Delete tool calls for old executions (must go before lua_executions due to FK)
      const luaToolCalls = this.db
        .prepare(
          `DELETE FROM lua_tool_calls WHERE execution_id IN (
            SELECT execution_id FROM lua_executions WHERE created_at < ?
          )`,
        )
        .run(cutoffMs).changes;

      const luaExecutions = this.db
        .prepare(`DELETE FROM lua_executions WHERE created_at < ?`)
        .run(cutoffMs).changes;

      const mcpEvents = this.db
        .prepare(`DELETE FROM mcp_events WHERE created_at < ?`)
        .run(cutoffMs).changes;

      // session_init_requests has no timestamp — delete orphans whose session is old
      const sessionInitRequests = this.db
        .prepare(
          `DELETE FROM session_init_requests WHERE session_id IN (
            SELECT session_id FROM sessions WHERE created_at < ?
          )`,
        )
        .run(cutoffMs).changes;

      const sessions = this.db
        .prepare(`DELETE FROM sessions WHERE created_at < ?`)
        .run(cutoffMs).changes;

      return {
        luaToolCalls,
        luaExecutions,
        mcpEvents,
        sessionInitRequests,
        sessions,
      };
    });
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
