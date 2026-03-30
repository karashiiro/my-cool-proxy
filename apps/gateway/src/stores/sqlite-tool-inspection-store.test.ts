import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteDatabase } from "./sqlite-database.js";
import { SQLiteToolInspectionStore } from "./sqlite-tool-inspection-store.js";

describe("SQLiteToolInspectionStore", () => {
  let db: SQLiteDatabase;
  let store: SQLiteToolInspectionStore;

  /** Insert a parent session row so FK constraints are satisfied. */
  function ensureSession(sessionId: string): void {
    db.getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)`,
      )
      .run(sessionId, Date.now(), Date.now());
  }

  beforeEach(() => {
    db = new SQLiteDatabase(":memory:");
    store = new SQLiteToolInspectionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("markInspected and isInspected", () => {
    it("should return false for uninspected tools", () => {
      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        false,
      );
    });

    it("should return true after marking a tool as inspected", () => {
      ensureSession("session1");
      store.markInspected("session1", "github", "search_issues");
      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        true,
      );
    });

    it("should track multiple tools per session", () => {
      ensureSession("session1");
      store.markInspected("session1", "github", "search_issues");
      store.markInspected("session1", "github", "create_pr");
      store.markInspected("session1", "slack", "send_message");

      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        true,
      );
      expect(store.isInspected("session1", "github", "create_pr")).toBe(true);
      expect(store.isInspected("session1", "slack", "send_message")).toBe(true);
      expect(store.isInspected("session1", "slack", "list_channels")).toBe(
        false,
      );
    });

    it("should isolate sessions from each other", () => {
      ensureSession("session1");
      store.markInspected("session1", "github", "search_issues");

      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        true,
      );
      expect(store.isInspected("session2", "github", "search_issues")).toBe(
        false,
      );
    });

    it("should handle marking the same tool twice without error", () => {
      ensureSession("session1");
      store.markInspected("session1", "github", "search_issues");
      store.markInspected("session1", "github", "search_issues");

      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        true,
      );
    });
  });

  describe("deleteSession", () => {
    it("should clear all inspections for a session", () => {
      ensureSession("session1");
      store.markInspected("session1", "github", "search_issues");
      store.markInspected("session1", "slack", "send_message");

      store.deleteSession("session1");

      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        false,
      );
      expect(store.isInspected("session1", "slack", "send_message")).toBe(
        false,
      );
    });

    it("should not affect other sessions", () => {
      ensureSession("session1");
      ensureSession("session2");
      store.markInspected("session1", "github", "search_issues");
      store.markInspected("session2", "github", "search_issues");

      store.deleteSession("session1");

      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        false,
      );
      expect(store.isInspected("session2", "github", "search_issues")).toBe(
        true,
      );
    });

    it("should handle deleting a non-existent session without error", () => {
      expect(() => store.deleteSession("nonexistent")).not.toThrow();
    });
  });

  describe("file persistence", () => {
    let testDbPath: string;
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `mcp-inspection-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      testDbPath = join(testDir, `test-${Date.now()}.db`);
    });

    afterEach(() => {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          if (existsSync(`${testDbPath}${suffix}`))
            unlinkSync(`${testDbPath}${suffix}`);
        } catch {
          // Ignore errors
        }
      }
    });

    it("should persist data across database close/reopen", () => {
      // Phase 1: Store data, close
      {
        const fileDb = new SQLiteDatabase(testDbPath);
        const fileStore = new SQLiteToolInspectionStore(fileDb);

        // Insert parent session row for FK constraint
        fileDb
          .getDatabase()
          .prepare(
            `INSERT INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)`,
          )
          .run("session1", Date.now(), Date.now());

        fileStore.markInspected("session1", "github", "search_issues");
        fileStore.markInspected("session1", "slack", "send_message");

        expect(
          fileStore.isInspected("session1", "github", "search_issues"),
        ).toBe(true);

        fileDb.close();
      }

      // Phase 2: Reopen, verify persisted
      {
        const fileDb = new SQLiteDatabase(testDbPath);
        const fileStore = new SQLiteToolInspectionStore(fileDb);

        expect(
          fileStore.isInspected("session1", "github", "search_issues"),
        ).toBe(true);
        expect(fileStore.isInspected("session1", "slack", "send_message")).toBe(
          true,
        );
        expect(fileStore.isInspected("session1", "github", "create_pr")).toBe(
          false,
        );

        fileDb.close();
      }
    });
  });
});
