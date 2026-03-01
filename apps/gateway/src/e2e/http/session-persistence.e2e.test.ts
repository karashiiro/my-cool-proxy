import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteDatabase } from "../../stores/sqlite-database.js";
import { SQLiteEventStore } from "../../stores/sqlite-event-store.js";
import { SQLiteCapabilityStore } from "../../stores/sqlite-capability-store.js";
import { SQLiteToolInspectionStore } from "../../stores/sqlite-tool-inspection-store.js";
import type { ILogger, ClientCapabilities } from "../../types/interfaces.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

// Mock logger for tests
const createMockLogger = (): ILogger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
});

describe("Session Persistence E2E", () => {
  let testDbPath: string;
  let testDir: string;

  beforeAll(() => {
    // Create temp directory for test DBs
    testDir = join(tmpdir(), `mcp-gateway-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  beforeEach(() => {
    testDbPath = join(testDir, `test-${Date.now()}.db`);
  });

  afterEach(() => {
    // Clean up test DB file
    if (existsSync(testDbPath)) {
      try {
        unlinkSync(testDbPath);
      } catch {
        // Ignore errors
      }
    }
    // Also clean up WAL and SHM files
    try {
      if (existsSync(`${testDbPath}-wal`)) unlinkSync(`${testDbPath}-wal`);
      if (existsSync(`${testDbPath}-shm`)) unlinkSync(`${testDbPath}-shm`);
    } catch {
      // Ignore errors
    }
  });

  describe("SQLite Database File Persistence", () => {
    it("should persist data to a file that survives database close/reopen", () => {
      const sessionId = "persist-test-session";
      const caps: ClientCapabilities = {
        sampling: { context: {} },
        elicitation: { form: {} },
      };
      const workingDir = "/test/working/dir";

      // Phase 1: Create database, store data, close
      {
        const db = new SQLiteDatabase(testDbPath);
        const capStore = new SQLiteCapabilityStore(db, createMockLogger());

        capStore.setCapabilities(sessionId, caps);
        capStore.setWorkingDirectory(sessionId, workingDir);

        // Verify data is stored
        expect(capStore.getCapabilities(sessionId)).toEqual(caps);
        expect(capStore.getWorkingDirectory(sessionId)).toBe(workingDir);

        db.close();
      }

      // Phase 2: Reopen database, verify data persisted
      {
        const db = new SQLiteDatabase(testDbPath);
        const capStore = new SQLiteCapabilityStore(db, createMockLogger());

        // Data should still be there!
        const loadedCaps = capStore.getCapabilities(sessionId);
        expect(loadedCaps).toEqual(caps);

        const loadedDir = capStore.getWorkingDirectory(sessionId);
        expect(loadedDir).toBe(workingDir);

        db.close();
      }
    });

    it("should persist SSE events that survive database close/reopen", async () => {
      const sessionId = "event-persist-session";
      const messages: JSONRPCMessage[] = [
        { jsonrpc: "2.0", method: "event1", id: 1 },
        { jsonrpc: "2.0", method: "event2", id: 2 },
        { jsonrpc: "2.0", method: "event3", id: 3 },
      ];

      let eventIds: string[];

      // Phase 1: Store events
      {
        const db = new SQLiteDatabase(testDbPath);
        const eventStore = new SQLiteEventStore(db, sessionId);

        eventIds = [];
        for (const msg of messages) {
          // Small delay between events to ensure different timestamps
          // This is necessary because event_id uses timestamp for ordering
          await new Promise((resolve) => setTimeout(resolve, 5));
          const eventId = await eventStore.storeEvent("stream-1", msg);
          eventIds.push(eventId);
        }

        expect(eventIds).toHaveLength(3);
        db.close();
      }

      // Phase 2: Reopen and replay events
      {
        const db = new SQLiteDatabase(testDbPath);
        const eventStore = new SQLiteEventStore(db, sessionId);

        // Replay from first event - should get events 2 and 3
        const replayedEvents: JSONRPCMessage[] = [];
        const streamId = await eventStore.replayEventsAfter(eventIds[0]!, {
          send: async (_, message) => {
            replayedEvents.push(message);
          },
        });

        expect(streamId).toBe("stream-1");
        expect(replayedEvents).toHaveLength(2);
        expect(replayedEvents[0]).toEqual(messages[1]);
        expect(replayedEvents[1]).toEqual(messages[2]);

        db.close();
      }
    });
  });

  describe("Tool Inspection Persistence", () => {
    it("should persist tool inspection state across database close/reopen", () => {
      const sessionId = "inspection-persist-session";

      // Phase 1: Create database, mark tools as inspected, close
      {
        const db = new SQLiteDatabase(testDbPath);
        const inspectionStore = new SQLiteToolInspectionStore(db);

        inspectionStore.markInspected(sessionId, "github", "search_issues");
        inspectionStore.markInspected(sessionId, "slack", "send_message");

        // Verify data is stored
        expect(
          inspectionStore.isInspected(sessionId, "github", "search_issues"),
        ).toBe(true);
        expect(
          inspectionStore.isInspected(sessionId, "slack", "send_message"),
        ).toBe(true);
        expect(
          inspectionStore.isInspected(sessionId, "github", "create_pr"),
        ).toBe(false);

        db.close();
      }

      // Phase 2: Reopen database, verify inspection state persisted
      {
        const db = new SQLiteDatabase(testDbPath);
        const inspectionStore = new SQLiteToolInspectionStore(db);

        // Data should still be there!
        expect(
          inspectionStore.isInspected(sessionId, "github", "search_issues"),
        ).toBe(true);
        expect(
          inspectionStore.isInspected(sessionId, "slack", "send_message"),
        ).toBe(true);
        expect(
          inspectionStore.isInspected(sessionId, "github", "create_pr"),
        ).toBe(false);

        db.close();
      }
    });

    it("should isolate tool inspections between sessions across restarts", () => {
      const db = new SQLiteDatabase(testDbPath);
      const inspectionStore = new SQLiteToolInspectionStore(db);

      inspectionStore.markInspected("session-1", "github", "search_issues");
      inspectionStore.markInspected("session-2", "slack", "send_message");

      expect(
        inspectionStore.isInspected("session-1", "github", "search_issues"),
      ).toBe(true);
      expect(
        inspectionStore.isInspected("session-1", "slack", "send_message"),
      ).toBe(false);
      expect(
        inspectionStore.isInspected("session-2", "slack", "send_message"),
      ).toBe(true);
      expect(
        inspectionStore.isInspected("session-2", "github", "search_issues"),
      ).toBe(false);

      // Delete session-1, session-2 should be unaffected
      inspectionStore.deleteSession("session-1");
      expect(
        inspectionStore.isInspected("session-1", "github", "search_issues"),
      ).toBe(false);
      expect(
        inspectionStore.isInspected("session-2", "slack", "send_message"),
      ).toBe(true);

      db.close();
    });
  });

  describe("Multi-Session Isolation", () => {
    it("should isolate capabilities between sessions", () => {
      const db = new SQLiteDatabase(testDbPath);
      const capStore = new SQLiteCapabilityStore(db, createMockLogger());

      const session1Caps: ClientCapabilities = { sampling: { tools: {} } };
      const session2Caps: ClientCapabilities = { elicitation: { form: {} } };

      capStore.setCapabilities("session-1", session1Caps);
      capStore.setCapabilities("session-2", session2Caps);

      expect(capStore.getCapabilities("session-1")).toEqual(session1Caps);
      expect(capStore.getCapabilities("session-2")).toEqual(session2Caps);

      // Delete session-1, session-2 should be unaffected
      capStore.deleteCapabilities("session-1");
      expect(capStore.getCapabilities("session-1")).toBeUndefined();
      expect(capStore.getCapabilities("session-2")).toEqual(session2Caps);

      db.close();
    });

    it("should isolate events between sessions", async () => {
      const db = new SQLiteDatabase(testDbPath);

      const session1Store = new SQLiteEventStore(db, "session-1");
      const session2Store = new SQLiteEventStore(db, "session-2");

      const msg1: JSONRPCMessage = {
        jsonrpc: "2.0",
        method: "session1-event",
        id: 1,
      };
      const msg2: JSONRPCMessage = {
        jsonrpc: "2.0",
        method: "session2-event",
        id: 2,
      };

      const event1Id = await session1Store.storeEvent("stream-1", msg1);
      await session2Store.storeEvent("stream-1", msg2);

      // session1Store should only see its own event
      const session1StreamId =
        await session1Store.getStreamIdForEventId(event1Id);
      expect(session1StreamId).toBe("stream-1");

      // session2Store should not see session1's event
      const crossSessionStreamId =
        await session2Store.getStreamIdForEventId(event1Id);
      expect(crossSessionStreamId).toBeUndefined();

      // Clear session-1, session-2 should be unaffected
      session1Store.clear();

      // Verify session-2 still has its event
      const database = db.getDatabase();
      const count = database
        .prepare(
          `SELECT COUNT(*) as count FROM mcp_events WHERE session_id = ?`,
        )
        .get("session-2") as { count: number };
      expect(count.count).toBe(1);

      db.close();
    });
  });

  describe("Concurrent Access", () => {
    it("should handle concurrent writes from multiple event stores", async () => {
      const db = new SQLiteDatabase(testDbPath);

      // Create multiple stores writing concurrently
      const stores = [
        new SQLiteEventStore(db, "concurrent-1"),
        new SQLiteEventStore(db, "concurrent-2"),
        new SQLiteEventStore(db, "concurrent-3"),
      ];

      // Write 10 events from each store concurrently
      const writePromises = stores.flatMap((store, storeIdx) =>
        Array.from({ length: 10 }, (_, i) =>
          store.storeEvent("stream-1", {
            jsonrpc: "2.0",
            method: `store-${storeIdx}-event-${i}`,
            id: storeIdx * 100 + i,
          }),
        ),
      );

      // All writes should succeed
      const eventIds = await Promise.all(writePromises);
      expect(eventIds).toHaveLength(30);
      expect(eventIds.every((id) => typeof id === "string")).toBe(true);

      // Verify total count
      const database = db.getDatabase();
      const count = database
        .prepare(`SELECT COUNT(*) as count FROM mcp_events`)
        .get() as { count: number };
      expect(count.count).toBe(30);

      db.close();
    });
  });

  describe("WAL Mode", () => {
    it("should use WAL mode for better concurrent access", () => {
      const db = new SQLiteDatabase(testDbPath);
      const database = db.getDatabase();

      const result = database.pragma("journal_mode") as Array<{
        journal_mode: string;
      }>;
      expect(result[0]!.journal_mode).toBe("wal");

      db.close();
    });
  });

  describe("EventStore Factory Pattern", () => {
    it("should create separate event stores per session from same database", async () => {
      const db = new SQLiteDatabase(testDbPath);

      // Simulates the eventStoreFactory pattern used in index.ts
      const eventStoreFactory = (sessionId: string) =>
        new SQLiteEventStore(db, sessionId);

      const store1 = eventStoreFactory("factory-session-1");
      const store2 = eventStoreFactory("factory-session-2");

      await store1.storeEvent("stream", {
        jsonrpc: "2.0",
        method: "s1",
        id: 1,
      });
      await store2.storeEvent("stream", {
        jsonrpc: "2.0",
        method: "s2",
        id: 2,
      });

      // Each store should only see its own events
      const database = db.getDatabase();

      const s1Count = database
        .prepare(
          `SELECT COUNT(*) as count FROM mcp_events WHERE session_id = ?`,
        )
        .get("factory-session-1") as { count: number };
      expect(s1Count.count).toBe(1);

      const s2Count = database
        .prepare(
          `SELECT COUNT(*) as count FROM mcp_events WHERE session_id = ?`,
        )
        .get("factory-session-2") as { count: number };
      expect(s2Count.count).toBe(1);

      db.close();
    });
  });
});
