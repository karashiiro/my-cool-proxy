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
