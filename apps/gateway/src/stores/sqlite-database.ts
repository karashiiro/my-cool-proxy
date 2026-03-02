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
    this.db.pragma("journal_mode = WAL");
    this.initializeDatabase();
    this.db.pragma("foreign_keys = ON");
  }

  /**
   * Initialize the database schema.
   * Creates tables if they don't exist.
   */
  private initializeSchema(): void {
    // Sessions table for capability persistence (parent table — must be created first)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        capabilities TEXT,
        working_directory TEXT,
        created_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL
      );
    `);

    // Events table for SSE resumability
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_events (
        event_id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_stream ON mcp_events(session_id, stream_id, event_id);
      CREATE INDEX IF NOT EXISTS idx_session_created ON mcp_events(session_id, created_at);
    `);

    // Session init requests table for session restoration
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_init_requests (
        session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
        request TEXT NOT NULL
      );
    `);

    // Tool inspection tracking (survives restarts so agents don't need to re-call tool-details)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_inspections (
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        tool_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, tool_key)
      );
    `);

    // Lua execution log table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lua_executions (
        execution_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
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
        execution_id TEXT NOT NULL REFERENCES lua_executions(execution_id) ON DELETE CASCADE,
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
   * Current schema version. Increment when adding new migrations.
   */
  private static readonly SCHEMA_VERSION = 1;

  /**
   * Check whether the sessions table already exists in sqlite_master.
   * Used to distinguish a fresh database (user_version=0, no tables) from
   * a legacy v0 database (user_version=0, tables present but no CASCADE FKs).
   */
  private tablesExist(): boolean {
    const row = this.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'`,
      )
      .get() as { name: string } | undefined;
    return row !== undefined;
  }

  /**
   * Unified database initialization: creates schema and runs any pending
   * migrations, distinguishing fresh DBs from legacy v0 DBs.
   */
  private initializeDatabase(): void {
    const currentVersion = (
      this.db.pragma("user_version") as Array<{ user_version: number }>
    )[0]!.user_version;

    if (currentVersion === 0 && !this.tablesExist()) {
      // Fresh database — create schema at the current version, no migration needed
      this.initializeSchema();
      this.db.pragma(`user_version = ${SQLiteDatabase.SCHEMA_VERSION}`);
    } else if (currentVersion === 0 && this.tablesExist()) {
      // Legacy v0 database — create any missing tables, then migrate
      this.initializeSchema();
      this.migrateSchema(currentVersion);
    } else {
      // Already-migrated database — create any additive table changes, skip migration
      this.initializeSchema();
    }
  }

  /**
   * Migrate the database schema to the current version.
   * Uses PRAGMA user_version to track which migrations have been applied.
   * Runs with foreign_keys OFF (the default) so orphaned rows in
   * existing databases don't block the migration.
   *
   * @param currentVersion The version read before any schema changes were made
   */
  private migrateSchema(currentVersion: number): void {
    if (currentVersion >= SQLiteDatabase.SCHEMA_VERSION) {
      return;
    }

    if (currentVersion < 1) {
      this.migrateToV1();
    }

    this.db.pragma(`user_version = ${SQLiteDatabase.SCHEMA_VERSION}`);
  }

  /**
   * Migration v0 → v1: Add ON DELETE CASCADE foreign keys to all
   * session-dependent tables. SQLite doesn't support ALTER TABLE to
   * add constraints, so we recreate each table.
   *
   * better-sqlite3 enables foreign_keys by default, so we explicitly
   * disable it for the duration of the migration to allow the table
   * recreation steps to complete without FK violations.
   */
  private migrateToV1(): void {
    // foreign_keys cannot be changed inside a transaction — set it before.
    this.db.pragma("foreign_keys = OFF");
    this.db.transaction(() => {
      // mcp_events: add FK to sessions
      this.db.exec(`
        CREATE TABLE mcp_events_new (
          event_id TEXT PRIMARY KEY,
          stream_id TEXT NOT NULL,
          session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
          message TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        INSERT INTO mcp_events_new SELECT * FROM mcp_events;
        DROP TABLE mcp_events;
        ALTER TABLE mcp_events_new RENAME TO mcp_events;
        CREATE INDEX idx_session_stream ON mcp_events(session_id, stream_id, event_id);
        CREATE INDEX idx_session_created ON mcp_events(session_id, created_at);
      `);

      // session_init_requests: add FK to sessions
      this.db.exec(`
        CREATE TABLE session_init_requests_new (
          session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
          request TEXT NOT NULL
        );
        INSERT INTO session_init_requests_new SELECT * FROM session_init_requests;
        DROP TABLE session_init_requests;
        ALTER TABLE session_init_requests_new RENAME TO session_init_requests;
      `);

      // tool_inspections: add FK to sessions
      this.db.exec(`
        CREATE TABLE tool_inspections_new (
          session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
          tool_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, tool_key)
        );
        INSERT INTO tool_inspections_new SELECT * FROM tool_inspections;
        DROP TABLE tool_inspections;
        ALTER TABLE tool_inspections_new RENAME TO tool_inspections;
      `);

      // lua_executions: add FK to sessions
      this.db.exec(`
        CREATE TABLE lua_executions_new (
          execution_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
          script TEXT NOT NULL,
          status TEXT NOT NULL,
          error TEXT,
          result TEXT,
          created_at INTEGER NOT NULL
        );
        INSERT INTO lua_executions_new SELECT * FROM lua_executions;
        DROP TABLE lua_executions;
        ALTER TABLE lua_executions_new RENAME TO lua_executions;
        CREATE INDEX idx_lua_executions_session_created
          ON lua_executions(session_id, created_at DESC);
      `);

      // lua_tool_calls: update existing FK to add CASCADE
      this.db.exec(`
        CREATE TABLE lua_tool_calls_new (
          call_id TEXT PRIMARY KEY,
          execution_id TEXT NOT NULL REFERENCES lua_executions(execution_id) ON DELETE CASCADE,
          server_name TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          arguments TEXT,
          status TEXT NOT NULL,
          error TEXT,
          result TEXT,
          created_at INTEGER NOT NULL
        );
        INSERT INTO lua_tool_calls_new SELECT * FROM lua_tool_calls;
        DROP TABLE lua_tool_calls;
        ALTER TABLE lua_tool_calls_new RENAME TO lua_tool_calls;
        CREATE INDEX idx_lua_tool_calls_execution
          ON lua_tool_calls(execution_id, created_at DESC);
        CREATE INDEX idx_lua_tool_calls_tool
          ON lua_tool_calls(server_name, tool_name);
      `);
    })();
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
    toolInspections: number;
    sessionInitRequests: number;
    sessions: number;
  } {
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    return this.transaction(() => {
      // Delete old events by their own timestamp (independent of session age)
      const mcpEvents = this.db
        .prepare(`DELETE FROM mcp_events WHERE created_at < ?`)
        .run(cutoffMs).changes;

      // Delete old executions by their own timestamp.
      // ON DELETE CASCADE automatically removes associated lua_tool_calls.
      const luaExecutions = this.db
        .prepare(`DELETE FROM lua_executions WHERE created_at < ?`)
        .run(cutoffMs).changes;

      // Delete old sessions by their own timestamp.
      // ON DELETE CASCADE automatically removes associated tool_inspections,
      // session_init_requests, and any remaining mcp_events/lua_executions
      // (which in turn cascade to lua_tool_calls).
      // Note: this may remove lua_executions/mcp_events that are newer than
      // the cutoff if their parent session is old.
      const sessions = this.db
        .prepare(`DELETE FROM sessions WHERE created_at < ?`)
        .run(cutoffMs).changes;

      return {
        // Cascaded deletes are not reflected in SQLite's changes count,
        // so these are reported as 0. The luaExecutions and mcpEvents counts
        // also exclude rows removed transitively by the sessions cascade.
        luaToolCalls: 0,
        luaExecutions,
        mcpEvents,
        toolInspections: 0,
        sessionInitRequests: 0,
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
