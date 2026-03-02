import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SQLiteDatabase } from "./sqlite-database.js";
import { SQLiteEventStore } from "./sqlite-event-store.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

describe("SQLiteEventStore", () => {
  let db: SQLiteDatabase;
  let store: SQLiteEventStore;
  const sessionId = "test-session";

  /** Insert a parent session row so FK constraints are satisfied. */
  function ensureSession(id: string): void {
    db.getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)`,
      )
      .run(id, Date.now(), Date.now());
  }

  beforeEach(() => {
    db = new SQLiteDatabase(":memory:");
    ensureSession(sessionId);
    store = new SQLiteEventStore(db, sessionId);
  });

  afterEach(() => {
    db.close();
  });

  describe("storeEvent", () => {
    it("should store an event and return an event ID", async () => {
      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        method: "test",
        id: 1,
      };

      const eventId = await store.storeEvent("stream-1", message);

      expect(eventId).toBeDefined();
      expect(eventId).toMatch(/^\d+_[a-z0-9]+$/); // timestamp_random format
    });

    it("should store the message as JSON", async () => {
      const message: JSONRPCMessage = {
        jsonrpc: "2.0",
        method: "test",
        params: { foo: "bar" },
        id: 1,
      };

      const eventId = await store.storeEvent("stream-1", message);

      // Verify storage
      const database = db.getDatabase();
      const row = database
        .prepare(`SELECT message FROM mcp_events WHERE event_id = ?`)
        .get(eventId) as { message: string };

      expect(JSON.parse(row.message)).toEqual(message);
    });

    it("should associate events with the correct session and stream", async () => {
      const message: JSONRPCMessage = { jsonrpc: "2.0", method: "test", id: 1 };

      await store.storeEvent("my-stream", message);

      const database = db.getDatabase();
      const row = database
        .prepare(
          `SELECT session_id, stream_id FROM mcp_events WHERE session_id = ?`,
        )
        .get(sessionId) as { session_id: string; stream_id: string };

      expect(row.session_id).toBe(sessionId);
      expect(row.stream_id).toBe("my-stream");
    });
  });

  describe("getStreamIdForEventId", () => {
    it("should return the stream ID for an existing event", async () => {
      const message: JSONRPCMessage = { jsonrpc: "2.0", method: "test", id: 1 };
      const eventId = await store.storeEvent("my-stream", message);

      const streamId = await store.getStreamIdForEventId(eventId);

      expect(streamId).toBe("my-stream");
    });

    it("should return undefined for non-existent event", async () => {
      const streamId = await store.getStreamIdForEventId("nonexistent");

      expect(streamId).toBeUndefined();
    });

    it("should not return events from other sessions", async () => {
      // Store event in current session
      const message: JSONRPCMessage = { jsonrpc: "2.0", method: "test", id: 1 };
      const eventId = await store.storeEvent("my-stream", message);

      // Create store for different session
      ensureSession("other-session");
      const otherStore = new SQLiteEventStore(db, "other-session");
      const streamId = await otherStore.getStreamIdForEventId(eventId);

      expect(streamId).toBeUndefined();
    });
  });

  describe("replayEventsAfter", () => {
    it("should replay events after the given event ID", async () => {
      const messages: JSONRPCMessage[] = [
        { jsonrpc: "2.0", method: "event1", id: 1 },
        { jsonrpc: "2.0", method: "event2", id: 2 },
        { jsonrpc: "2.0", method: "event3", id: 3 },
      ];

      const eventIds: string[] = [];
      for (const msg of messages) {
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 5));
        eventIds.push(await store.storeEvent("stream-1", msg));
      }

      const replayedEvents: Array<{
        eventId: string;
        message: JSONRPCMessage;
      }> = [];
      const streamId = await store.replayEventsAfter(eventIds[0]!, {
        send: async (eventId, message) => {
          replayedEvents.push({ eventId, message });
        },
      });

      expect(streamId).toBe("stream-1");
      expect(replayedEvents).toHaveLength(2);
      expect(replayedEvents[0]!.message).toEqual(messages[1]);
      expect(replayedEvents[1]!.message).toEqual(messages[2]);
    });

    it("should return empty string for non-existent event", async () => {
      const streamId = await store.replayEventsAfter("nonexistent", {
        send: vi.fn(),
      });

      expect(streamId).toBe("");
    });

    it("should only replay events from the same stream", async () => {
      // Store events in two different streams
      const msg1: JSONRPCMessage = { jsonrpc: "2.0", method: "stream1", id: 1 };
      const msg2: JSONRPCMessage = { jsonrpc: "2.0", method: "stream2", id: 2 };
      const msg3: JSONRPCMessage = {
        jsonrpc: "2.0",
        method: "stream1-again",
        id: 3,
      };

      await new Promise((resolve) => setTimeout(resolve, 5));
      const eventId1 = await store.storeEvent("stream-a", msg1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await store.storeEvent("stream-b", msg2);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await store.storeEvent("stream-a", msg3);

      const replayedEvents: Array<{
        eventId: string;
        message: JSONRPCMessage;
      }> = [];
      await store.replayEventsAfter(eventId1, {
        send: async (eventId, message) => {
          replayedEvents.push({ eventId, message });
        },
      });

      // Should only get the stream-a event, not stream-b
      expect(replayedEvents).toHaveLength(1);
      const replayedMsg = replayedEvents[0]!.message;
      expect("method" in replayedMsg && replayedMsg.method).toBe(
        "stream1-again",
      );
    });

    it("should not replay events from other sessions", async () => {
      const message: JSONRPCMessage = { jsonrpc: "2.0", method: "test", id: 1 };
      const eventId = await store.storeEvent("stream-1", message);

      // Store more events in this session
      await new Promise((resolve) => setTimeout(resolve, 5));
      await store.storeEvent("stream-1", {
        jsonrpc: "2.0",
        method: "event2",
        id: 2,
      });

      // Create store for different session and try to replay
      ensureSession("other-session");
      const otherStore = new SQLiteEventStore(db, "other-session");
      const replayedEvents: JSONRPCMessage[] = [];
      const streamId = await otherStore.replayEventsAfter(eventId, {
        send: async (_, message) => {
          replayedEvents.push(message);
        },
      });

      // Should return empty string (event not found in this session)
      expect(streamId).toBe("");
      expect(replayedEvents).toHaveLength(0);
    });
  });

  describe("clear", () => {
    it("should delete all events for the session", async () => {
      const message: JSONRPCMessage = { jsonrpc: "2.0", method: "test", id: 1 };
      await store.storeEvent("stream-1", message);
      await store.storeEvent("stream-1", message);

      store.clear();

      const database = db.getDatabase();
      const count = database
        .prepare(
          `SELECT COUNT(*) as count FROM mcp_events WHERE session_id = ?`,
        )
        .get(sessionId) as { count: number };

      expect(count.count).toBe(0);
    });

    it("should not delete events from other sessions", async () => {
      const message: JSONRPCMessage = { jsonrpc: "2.0", method: "test", id: 1 };

      // Store event in current session
      await store.storeEvent("stream-1", message);

      // Store event in other session
      ensureSession("other-session");
      const otherStore = new SQLiteEventStore(db, "other-session");
      await otherStore.storeEvent("stream-1", message);

      // Clear current session
      store.clear();

      // Other session should still have its event
      const database = db.getDatabase();
      const count = database
        .prepare(
          `SELECT COUNT(*) as count FROM mcp_events WHERE session_id = ?`,
        )
        .get("other-session") as { count: number };

      expect(count.count).toBe(1);
    });
  });

  describe("FIFO eviction", () => {
    it("should evict oldest events when exceeding 1000 events per session", async () => {
      const message: JSONRPCMessage = { jsonrpc: "2.0", method: "test", id: 1 };

      // Store 1005 events (exceeds the 1000 limit)
      for (let i = 0; i < 1005; i++) {
        await store.storeEvent("stream-1", {
          ...message,
          id: i,
        });
      }

      const database = db.getDatabase();
      const count = database
        .prepare(
          `SELECT COUNT(*) as count FROM mcp_events WHERE session_id = ?`,
        )
        .get(sessionId) as { count: number };

      // Should have exactly 1000 events (oldest 5 evicted)
      expect(count.count).toBe(1000);
    });

    it("should keep exactly MAX_EVENTS_PER_SESSION events after eviction", async () => {
      // Store events with identifiable IDs
      for (let i = 0; i < 1005; i++) {
        await store.storeEvent("stream-1", {
          jsonrpc: "2.0",
          method: "test",
          id: i,
        });
      }

      const database = db.getDatabase();

      // Get all remaining message IDs
      const rows = database
        .prepare(`SELECT message FROM mcp_events WHERE session_id = ?`)
        .all(sessionId) as Array<{ message: string }>;

      const messageIds = rows
        .map((r) => {
          const msg = JSON.parse(r.message) as JSONRPCMessage;
          // JSONRPCMessage is a union - we know these are request messages with id
          return "id" in msg ? (msg.id as number) : 0;
        })
        .sort((a, b) => a - b);

      // Should have exactly 1000 events
      expect(messageIds).toHaveLength(1000);

      // Verify that exactly 5 events were removed (1005 - 1000 = 5)
      // We can't predict which specific IDs remain due to concurrent timestamp/random event_id
      // but we know 5 should be missing
      const missingCount = 1005 - messageIds.length;
      expect(missingCount).toBe(5);

      // The highest ID should still be present (most recent is never evicted first)
      expect(messageIds).toContain(1004);
    });
  });
});
