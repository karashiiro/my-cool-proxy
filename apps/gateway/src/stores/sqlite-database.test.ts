import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

      database
        .prepare(
          `INSERT INTO tool_inspections (session_id, tool_key, created_at) VALUES (?, ?, ?)`,
        )
        .run(`session-${suffix}`, `server.tool-${suffix}`, createdAt);
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
        toolInspections: count("tool_inspections"),
      };
    }

    it("should delete data older than retention period", () => {
      db = new SQLiteDatabase(":memory:");
      seedData(db, 10, "old"); // 10 days old
      seedData(db, 1, "recent"); // 1 day old

      const result = db.purgeOldData(7);

      expect(result.sessions).toBe(1);
      expect(result.mcpEvents).toBe(1);
      expect(result.luaExecutions).toBe(1);
      // Cascaded deletes are not reflected in SQLite's changes count
      expect(result.luaToolCalls).toBe(0);
      expect(result.sessionInitRequests).toBe(0);
      expect(result.toolInspections).toBe(0);

      // But the actual rows should still be gone
      const counts = countAll(db);
      expect(counts.sessions).toBe(1);
      expect(counts.sessionInitRequests).toBe(1);
      expect(counts.mcpEvents).toBe(1);
      expect(counts.luaExecutions).toBe(1);
      expect(counts.luaToolCalls).toBe(1);
      expect(counts.toolInspections).toBe(1);
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
      // Cascaded counts are 0 (handled by ON DELETE CASCADE)
      expect(result.luaToolCalls).toBe(0);
      expect(result.toolInspections).toBe(0);

      // But actual rows are gone via cascade
      const counts = countAll(db);
      expect(counts.sessions).toBe(0);
      expect(counts.luaToolCalls).toBe(0);
      expect(counts.toolInspections).toBe(0);
    });
  });

  describe("foreign keys", () => {
    it("should enable foreign_keys pragma", () => {
      db = new SQLiteDatabase(":memory:");
      const result = db.getDatabase().pragma("foreign_keys") as Array<{
        foreign_keys: number;
      }>;
      expect(result[0]!.foreign_keys).toBe(1);
    });

    it("should reject inserts with nonexistent parent session", () => {
      db = new SQLiteDatabase(":memory:");
      const database = db.getDatabase();

      expect(() =>
        database
          .prepare(
            `INSERT INTO mcp_events (event_id, stream_id, session_id, message, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run("evt-1", "stream-1", "nonexistent-session", "{}", Date.now()),
      ).toThrow(/FOREIGN KEY/);
    });

    it("should reject lua_tool_calls with nonexistent execution", () => {
      db = new SQLiteDatabase(":memory:");
      const database = db.getDatabase();

      expect(() =>
        database
          .prepare(
            `INSERT INTO lua_tool_calls (call_id, execution_id, server_name, tool_name, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "call-1",
            "nonexistent-exec",
            "server",
            "tool",
            "success",
            Date.now(),
          ),
      ).toThrow(/FOREIGN KEY/);
    });

    it("should cascade delete children when session is deleted", () => {
      db = new SQLiteDatabase(":memory:");
      const database = db.getDatabase();
      const now = Date.now();

      // Insert parent session
      database
        .prepare(
          `INSERT INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)`,
        )
        .run("s1", now, now);

      // Insert children
      database
        .prepare(
          `INSERT INTO mcp_events (event_id, stream_id, session_id, message, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("evt-1", "stream-1", "s1", "{}", now);

      database
        .prepare(
          `INSERT INTO session_init_requests (session_id, request) VALUES (?, ?)`,
        )
        .run("s1", '{"method":"initialize"}');

      database
        .prepare(
          `INSERT INTO tool_inspections (session_id, tool_key, created_at) VALUES (?, ?, ?)`,
        )
        .run("s1", "server.tool", now);

      database
        .prepare(
          `INSERT INTO lua_executions (execution_id, session_id, script, status, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("exec-1", "s1", 'result("hi")', "success", now);

      database
        .prepare(
          `INSERT INTO lua_tool_calls (call_id, execution_id, server_name, tool_name, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("call-1", "exec-1", "server", "tool", "success", now);

      // Delete the session
      database.prepare(`DELETE FROM sessions WHERE session_id = ?`).run("s1");

      // All children should be gone
      const count = (table: string) =>
        (
          database.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as {
            c: number;
          }
        ).c;

      expect(count("mcp_events")).toBe(0);
      expect(count("session_init_requests")).toBe(0);
      expect(count("tool_inspections")).toBe(0);
      expect(count("lua_executions")).toBe(0);
      expect(count("lua_tool_calls")).toBe(0);
    });

    it("should cascade lua_tool_calls when lua_execution is deleted", () => {
      db = new SQLiteDatabase(":memory:");
      const database = db.getDatabase();
      const now = Date.now();

      database
        .prepare(
          `INSERT INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)`,
        )
        .run("s1", now, now);

      database
        .prepare(
          `INSERT INTO lua_executions (execution_id, session_id, script, status, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("exec-1", "s1", 'result("hi")', "success", now);

      database
        .prepare(
          `INSERT INTO lua_tool_calls (call_id, execution_id, server_name, tool_name, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("call-1", "exec-1", "server", "tool", "success", now);

      // Delete the execution (not the session)
      database
        .prepare(`DELETE FROM lua_executions WHERE execution_id = ?`)
        .run("exec-1");

      const count = (
        database.prepare(`SELECT COUNT(*) as c FROM lua_tool_calls`).get() as {
          c: number;
        }
      ).c;
      expect(count).toBe(0);
    });
  });

  describe("migration", () => {
    let tempDir: string | null = null;

    afterEach(() => {
      if (db) {
        db.close();
        db = null;
      }
      if (tempDir) {
        rmSync(tempDir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
        tempDir = null;
      }
    });

    it("should migrate a v0 database to v1 with cascade FKs", () => {
      // Create a temp directory and file path for the test DB
      tempDir = mkdtempSync(join(tmpdir(), "sqlite-migration-test-"));
      const dbPath = join(tempDir, "test.db");

      // Open a raw better-sqlite3 Database at that path and set up v0 schema
      const raw = new Database(dbPath);
      raw.pragma("journal_mode = WAL");

      raw.exec(`
        CREATE TABLE sessions (
          session_id TEXT PRIMARY KEY,
          capabilities TEXT,
          working_directory TEXT,
          created_at INTEGER NOT NULL,
          last_activity INTEGER NOT NULL
        );
        CREATE TABLE mcp_events (
          event_id TEXT PRIMARY KEY,
          stream_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_session_stream ON mcp_events(session_id, stream_id, event_id);
        CREATE INDEX idx_session_created ON mcp_events(session_id, created_at);
        CREATE TABLE session_init_requests (
          session_id TEXT PRIMARY KEY,
          request TEXT NOT NULL
        );
        CREATE TABLE tool_inspections (
          session_id TEXT NOT NULL,
          tool_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, tool_key)
        );
        CREATE TABLE lua_executions (
          execution_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          script TEXT NOT NULL,
          status TEXT NOT NULL,
          error TEXT,
          result TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_lua_executions_session_created
          ON lua_executions(session_id, created_at DESC);
        CREATE TABLE lua_tool_calls (
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
        CREATE INDEX idx_lua_tool_calls_execution
          ON lua_tool_calls(execution_id, created_at DESC);
        CREATE INDEX idx_lua_tool_calls_tool
          ON lua_tool_calls(server_name, tool_name);
      `);

      // Insert test data into ALL tables
      const now = Date.now();
      raw
        .prepare(
          `INSERT INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)`,
        )
        .run("s1", now, now);
      raw
        .prepare(
          `INSERT INTO mcp_events (event_id, stream_id, session_id, message, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run("evt-1", "stream-1", "s1", "{}", now);
      raw
        .prepare(
          `INSERT INTO session_init_requests (session_id, request) VALUES (?, ?)`,
        )
        .run("s1", '{"method":"initialize"}');
      raw
        .prepare(
          `INSERT INTO tool_inspections (session_id, tool_key, created_at) VALUES (?, ?, ?)`,
        )
        .run("s1", "server.tool", now);
      raw
        .prepare(
          `INSERT INTO lua_executions (execution_id, session_id, script, status, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run("exec-1", "s1", 'result("hi")', "success", now);
      raw
        .prepare(
          `INSERT INTO lua_tool_calls (call_id, execution_id, server_name, tool_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("call-1", "exec-1", "server", "tool", "success", now);

      // Close the raw database before opening with SQLiteDatabase
      raw.close();

      // Open the SAME file with SQLiteDatabase — this triggers migration
      db = new SQLiteDatabase(dbPath);
      const database = db.getDatabase();

      // user_version should be 1 after migration
      const version = (
        database.pragma("user_version") as Array<{ user_version: number }>
      )[0]!.user_version;
      expect(version).toBe(1);

      // foreign_keys pragma should be ON
      const fkEnabled = (
        database.pragma("foreign_keys") as Array<{ foreign_keys: number }>
      )[0]!.foreign_keys;
      expect(fkEnabled).toBe(1);

      // All pre-existing data was preserved
      const count = (table: string) =>
        (
          database.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as {
            c: number;
          }
        ).c;

      expect(count("sessions")).toBe(1);
      expect(count("mcp_events")).toBe(1);
      expect(count("session_init_requests")).toBe(1);
      expect(count("tool_inspections")).toBe(1);
      expect(count("lua_executions")).toBe(1);
      expect(count("lua_tool_calls")).toBe(1);

      // Specific row values are intact
      const session = database
        .prepare(`SELECT session_id FROM sessions WHERE session_id = ?`)
        .get("s1") as { session_id: string } | undefined;
      expect(session?.session_id).toBe("s1");

      const event = database
        .prepare(
          `SELECT event_id, stream_id FROM mcp_events WHERE event_id = ?`,
        )
        .get("evt-1") as { event_id: string; stream_id: string } | undefined;
      expect(event?.event_id).toBe("evt-1");
      expect(event?.stream_id).toBe("stream-1");

      const exec = database
        .prepare(
          `SELECT execution_id, script FROM lua_executions WHERE execution_id = ?`,
        )
        .get("exec-1") as { execution_id: string; script: string } | undefined;
      expect(exec?.execution_id).toBe("exec-1");
      expect(exec?.script).toBe('result("hi")');

      // All expected indexes exist in sqlite_master
      const indexes = database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='index' ORDER BY name`,
        )
        .all() as Array<{ name: string }>;
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain("idx_session_stream");
      expect(indexNames).toContain("idx_session_created");
      expect(indexNames).toContain("idx_lua_executions_session_created");
      expect(indexNames).toContain("idx_lua_tool_calls_execution");
      expect(indexNames).toContain("idx_lua_tool_calls_tool");

      // CASCADE deletes work: delete the session → all children gone
      database.prepare(`DELETE FROM sessions WHERE session_id = ?`).run("s1");

      expect(count("mcp_events")).toBe(0);
      expect(count("session_init_requests")).toBe(0);
      expect(count("tool_inspections")).toBe(0);
      expect(count("lua_executions")).toBe(0);
      expect(count("lua_tool_calls")).toBe(0);
    });

    it("should skip migration when database is already at v1", () => {
      // Create a temp directory and file path for the test DB
      tempDir = mkdtempSync(join(tmpdir(), "sqlite-migration-idempotent-"));
      const dbPath = join(tempDir, "test.db");

      // First open: initializes schema and sets user_version to 1
      const first = new SQLiteDatabase(dbPath);
      first.close();

      // Second open: should not throw and should still be at v1
      expect(() => {
        db = new SQLiteDatabase(dbPath);
      }).not.toThrow();

      const version = (
        db!.getDatabase().pragma("user_version") as Array<{
          user_version: number;
        }>
      )[0]!.user_version;
      expect(version).toBe(1);
    });

    it("should set user_version to 1 after migration", () => {
      db = new SQLiteDatabase(":memory:");
      const version = (
        db.getDatabase().pragma("user_version") as Array<{
          user_version: number;
        }>
      )[0]!.user_version;
      expect(version).toBe(1);
    });

    it("should preserve data through migration", () => {
      // Fresh database — initializeSchema creates tables, migrateSchema runs v0→v1
      db = new SQLiteDatabase(":memory:");
      const database = db.getDatabase();
      const now = Date.now();

      // Insert data and verify it survives (migration already happened in constructor)
      database
        .prepare(
          `INSERT INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)`,
        )
        .run("s1", now, now);
      database
        .prepare(
          `INSERT INTO mcp_events (event_id, stream_id, session_id, message, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .run("evt-1", "stream-1", "s1", "{}", now);

      const count = (
        database.prepare(`SELECT COUNT(*) as c FROM mcp_events`).get() as {
          c: number;
        }
      ).c;
      expect(count).toBe(1);
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
