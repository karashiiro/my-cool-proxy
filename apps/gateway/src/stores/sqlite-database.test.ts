import { describe, it, expect, afterEach } from "vitest";
import { SQLiteDatabase } from "./sqlite-database.js";

describe("SQLiteDatabase", () => {
  let db: SQLiteDatabase | null = null;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  describe("constructor", () => {
    it("should create an in-memory database", () => {
      db = new SQLiteDatabase(":memory:");
      expect(db).toBeDefined();
      expect(db.getDatabase()).toBeDefined();
    });

    it("should initialize schema on creation", () => {
      db = new SQLiteDatabase(":memory:");
      const database = db.getDatabase();

      // Check mcp_events table exists
      const eventsTable = database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_events'`,
        )
        .get() as { name: string } | undefined;
      expect(eventsTable?.name).toBe("mcp_events");

      // Check sessions table exists
      const sessionsTable = database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'`,
        )
        .get() as { name: string } | undefined;
      expect(sessionsTable?.name).toBe("sessions");

      // Check lua_executions table exists
      const executionsTable = database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='lua_executions'`,
        )
        .get() as { name: string } | undefined;
      expect(executionsTable?.name).toBe("lua_executions");

      // Check lua_tool_calls table exists
      const toolCallsTable = database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='lua_tool_calls'`,
        )
        .get() as { name: string } | undefined;
      expect(toolCallsTable?.name).toBe("lua_tool_calls");
    });

    it("should create indices for mcp_events table", () => {
      db = new SQLiteDatabase(":memory:");
      const database = db.getDatabase();

      const indices = database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='mcp_events'`,
        )
        .all() as Array<{ name: string }>;

      const indexNames = indices.map((i) => i.name);
      expect(indexNames).toContain("idx_session_stream");
      expect(indexNames).toContain("idx_session_created");
    });

    it("should create indices for lua_executions table", () => {
      db = new SQLiteDatabase(":memory:");
      const database = db.getDatabase();

      const indices = database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='lua_executions'`,
        )
        .all() as Array<{ name: string }>;

      const indexNames = indices.map((i) => i.name);
      expect(indexNames).toContain("idx_lua_executions_session_created");
    });

    it("should create indices for lua_tool_calls table", () => {
      db = new SQLiteDatabase(":memory:");
      const database = db.getDatabase();

      const indices = database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='lua_tool_calls'`,
        )
        .all() as Array<{ name: string }>;

      const indexNames = indices.map((i) => i.name);
      expect(indexNames).toContain("idx_lua_tool_calls_execution");
    });
  });

  describe("getDatabase", () => {
    it("should return the underlying database instance", () => {
      db = new SQLiteDatabase(":memory:");
      const database = db.getDatabase();
      expect(database).toBeDefined();
      expect(database.open).toBe(true);
    });
  });

  describe("transaction", () => {
    it("should execute a function within a transaction", () => {
      db = new SQLiteDatabase(":memory:");
      const database = db.getDatabase();

      const result = db.transaction(() => {
        database
          .prepare(
            `INSERT INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)`,
          )
          .run("test-session", Date.now(), Date.now());
        return "success";
      });

      expect(result).toBe("success");

      // Verify the insert happened
      const row = database
        .prepare(`SELECT session_id FROM sessions WHERE session_id = ?`)
        .get("test-session") as { session_id: string } | undefined;
      expect(row?.session_id).toBe("test-session");
    });

    it("should roll back transaction on error", () => {
      db = new SQLiteDatabase(":memory:");
      const database = db.getDatabase();

      // Insert one row first
      database
        .prepare(
          `INSERT INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)`,
        )
        .run("existing", Date.now(), Date.now());

      // Try to insert duplicate (should fail due to PRIMARY KEY constraint)
      expect(() =>
        db!.transaction(() => {
          database
            .prepare(
              `INSERT INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)`,
            )
            .run("new-session", Date.now(), Date.now());
          // This should fail
          database
            .prepare(
              `INSERT INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)`,
            )
            .run("existing", Date.now(), Date.now());
        }),
      ).toThrow();

      // Verify new-session was not inserted (rolled back)
      const row = database
        .prepare(`SELECT session_id FROM sessions WHERE session_id = ?`)
        .get("new-session") as { session_id: string } | undefined;
      expect(row).toBeUndefined();
    });
  });

  describe("purgeOldData", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;

    function seedData(db: SQLiteDatabase, ageInDays: number, suffix: string) {
      const database = db.getDatabase();
      const createdAt = Date.now() - ageInDays * DAY_MS;

      database
        .prepare(
          `INSERT INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)`,
        )
        .run(`session-${suffix}`, createdAt, createdAt);

      database
        .prepare(
          `INSERT INTO session_init_requests (session_id, request) VALUES (?, ?)`,
        )
        .run(`session-${suffix}`, '{"method":"initialize"}');

      database
        .prepare(
          `INSERT INTO mcp_events (event_id, stream_id, session_id, message, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(`evt-${suffix}`, "stream-1", `session-${suffix}`, "{}", createdAt);

      database
        .prepare(
          `INSERT INTO lua_executions (execution_id, session_id, script, status, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          `exec-${suffix}`,
          `session-${suffix}`,
          'result("hi")',
          "success",
          createdAt,
        );

      database
        .prepare(
          `INSERT INTO lua_tool_calls (call_id, execution_id, server_name, tool_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `call-${suffix}`,
          `exec-${suffix}`,
          "server",
          "tool",
          "success",
          createdAt,
        );
    }

    function countAll(db: SQLiteDatabase) {
      const database = db.getDatabase();
      const count = (table: string) =>
        (
          database.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as {
            c: number;
          }
        ).c;
      return {
        sessions: count("sessions"),
        sessionInitRequests: count("session_init_requests"),
        mcpEvents: count("mcp_events"),
        luaExecutions: count("lua_executions"),
        luaToolCalls: count("lua_tool_calls"),
      };
    }

    it("should delete data older than retention period", () => {
      db = new SQLiteDatabase(":memory:");
      seedData(db, 10, "old"); // 10 days old
      seedData(db, 1, "recent"); // 1 day old

      const result = db.purgeOldData(7);

      expect(result.sessions).toBe(1);
      expect(result.sessionInitRequests).toBe(1);
      expect(result.mcpEvents).toBe(1);
      expect(result.luaExecutions).toBe(1);
      expect(result.luaToolCalls).toBe(1);

      const counts = countAll(db);
      expect(counts.sessions).toBe(1);
      expect(counts.sessionInitRequests).toBe(1);
      expect(counts.mcpEvents).toBe(1);
      expect(counts.luaExecutions).toBe(1);
      expect(counts.luaToolCalls).toBe(1);
    });

    it("should preserve all data when nothing is expired", () => {
      db = new SQLiteDatabase(":memory:");
      seedData(db, 1, "a");
      seedData(db, 2, "b");

      const result = db.purgeOldData(7);

      expect(result.sessions).toBe(0);
      expect(result.luaExecutions).toBe(0);

      const counts = countAll(db);
      expect(counts.sessions).toBe(2);
    });

    it("should delete everything when retention is very short", () => {
      db = new SQLiteDatabase(":memory:");
      seedData(db, 1, "a");
      seedData(db, 2, "b");

      const result = db.purgeOldData(0.001); // ~86ms retention

      // Wait is not needed since seedData uses Date.now() - ageInDays * DAY_MS
      // Both are at least 1 day old, so both will be purged
      expect(result.sessions).toBe(2);
      expect(result.luaToolCalls).toBe(2);

      const counts = countAll(db);
      expect(counts.sessions).toBe(0);
      expect(counts.luaToolCalls).toBe(0);
    });
  });

  describe("close", () => {
    it("should close the database connection", () => {
      db = new SQLiteDatabase(":memory:");
      const database = db.getDatabase();
      expect(database.open).toBe(true);

      db.close();
      expect(database.open).toBe(false);
      db = null; // Prevent afterEach from trying to close again
    });
  });
});
