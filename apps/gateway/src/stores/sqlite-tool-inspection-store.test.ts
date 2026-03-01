import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteDatabase } from "./sqlite-database.js";
import { SQLiteToolInspectionStore } from "./sqlite-tool-inspection-store.js";

describe("SQLiteToolInspectionStore", () => {
  let db: SQLiteDatabase;
  let store: SQLiteToolInspectionStore;

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
      store.markInspected("session1", "github", "search_issues");
      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        true,
      );
    });

    it("should track multiple tools per session", () => {
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
      store.markInspected("session1", "github", "search_issues");

      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        true,
      );
      expect(store.isInspected("session2", "github", "search_issues")).toBe(
        false,
      );
    });

    it("should handle marking the same tool twice without error", () => {
      store.markInspected("session1", "github", "search_issues");
      store.markInspected("session1", "github", "search_issues");

      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        true,
      );
    });
  });

  describe("deleteSession", () => {
    it("should clear all inspections for a session", () => {
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
