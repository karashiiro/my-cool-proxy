import type { EventStore } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { SQLiteDatabase } from "./sqlite-database.js";
import { BaseSQLiteStore } from "./base-sqlite-store.js";
import { generateTimeId, safeExecute } from "./store-utils.js";

/**
 * Extended EventStore interface that includes cleanup and restoration methods.
 * Matches @karashiiro/mcp's EventStore interface.
 */
export interface ExtendedEventStore extends EventStore {
  clear(): void;
  hasSession?(sessionId: string): Promise<boolean>;
  storeInitializeRequest?(
    sessionId: string,
    request: JSONRPCMessage,
  ): Promise<void>;
  getInitializeRequest?(sessionId: string): Promise<JSONRPCMessage | undefined>;
}

/**
 * Maximum number of events to store per session.
 * When exceeded, oldest events are evicted (FIFO).
 */
const MAX_EVENTS_PER_SESSION = 1000;

/**
 * SQLite-backed event store for SSE resumability.
 * Each instance is scoped to a single session.
 *
 * Implements the EventStore interface from @karashiiro/mcp
 * to enable persistent SSE event storage across server restarts.
 */
export class SQLiteEventStore
  extends BaseSQLiteStore
  implements ExtendedEventStore
{
  private readonly sessionId: string;

  /**
   * Create a new SQLite event store for a session.
   * @param db SQLite database wrapper
   * @param sessionId Session ID this store is scoped to
   */
  constructor(db: SQLiteDatabase, sessionId: string) {
    super(db);
    this.sessionId = sessionId;
  }

  /**
   * Store an event for later retrieval.
   * @param streamId ID of the stream the event belongs to
   * @param message The JSON-RPC message to store
   * @returns The generated event ID for the stored event
   */
  async storeEvent(streamId: string, message: JSONRPCMessage): Promise<string> {
    return safeExecute(() => {
      const now = Date.now();
      const eventId = generateTimeId();
      const messageJson = JSON.stringify(message);

      this.database
        .prepare(
          `INSERT INTO mcp_events (event_id, stream_id, session_id, message, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(eventId, streamId, this.sessionId, messageJson, now);

      // FIFO eviction: delete oldest events if over the limit
      this.evictOldestIfNeeded();

      return eventId;
    }, "storeEvent");
  }

  /**
   * Get the stream ID associated with a given event ID.
   * @param eventId The event ID to look up
   * @returns The stream ID, or undefined if not found
   */
  async getStreamIdForEventId(eventId: string): Promise<string | undefined> {
    const row = this.database
      .prepare(
        `SELECT stream_id FROM mcp_events WHERE event_id = ? AND session_id = ?`,
      )
      .get(eventId, this.sessionId) as { stream_id: string } | undefined;
    return row?.stream_id;
  }

  /**
   * Replay events that occurred after a given event ID.
   * @param lastEventId The last event ID the client received
   * @param send Callback to send each replayed event
   * @returns The stream ID the events belong to
   */
  async replayEventsAfter(
    lastEventId: string,
    {
      send,
    }: {
      send: (eventId: string, message: JSONRPCMessage) => Promise<void>;
    },
  ): Promise<string> {
    // Read all data synchronously (better-sqlite3 is sync), then replay async.
    // safeExecute only wraps the synchronous SQLite portion so rejected
    // promises from `send` propagate naturally instead of being swallowed.
    const lastEventRow = safeExecute(
      () =>
        this.database
          .prepare(
            `SELECT stream_id, created_at FROM mcp_events WHERE event_id = ? AND session_id = ?`,
          )
          .get(lastEventId, this.sessionId) as
          | { stream_id: string; created_at: number }
          | undefined,
      "replayEventsAfter:lookup",
    );

    if (!lastEventRow) {
      // Event not found - return empty stream ID
      // The SDK handles this gracefully
      return "";
    }

    const streamId = lastEventRow.stream_id;

    // Get all events after the last event for this stream
    // Order by event_id to maintain chronological order (event_id starts with timestamp)
    const events = safeExecute(
      () =>
        this.database
          .prepare(
            `SELECT event_id, message FROM mcp_events
             WHERE session_id = ? AND stream_id = ? AND event_id > ?
             ORDER BY event_id ASC`,
          )
          .all(this.sessionId, streamId, lastEventId) as Array<{
          event_id: string;
          message: string;
        }>,
      "replayEventsAfter:fetch",
    );

    // Replay each event
    for (const event of events) {
      const message = JSON.parse(event.message) as JSONRPCMessage;
      await send(event.event_id, message);
    }

    return streamId;
  }

  /**
   * Clear all events for this session.
   * Called when the session is being closed/deleted.
   */
  clear(): void {
    this.database
      .prepare(`DELETE FROM mcp_events WHERE session_id = ?`)
      .run(this.sessionId);
    this.database
      .prepare(`DELETE FROM session_init_requests WHERE session_id = ?`)
      .run(this.sessionId);
  }

  /**
   * Check if this event store has data for the session.
   * Used during session restoration to determine if a session can be restored.
   */
  async hasSession(sessionId: string): Promise<boolean> {
    const row = this.database
      .prepare(
        `SELECT 1 FROM session_init_requests WHERE session_id = ? LIMIT 1`,
      )
      .get(sessionId);
    return row !== undefined;
  }

  /**
   * Store the initialization request for session restoration.
   * Called when a new session is created so it can be replayed during restoration.
   */
  async storeInitializeRequest(
    sessionId: string,
    request: JSONRPCMessage,
  ): Promise<void> {
    safeExecute(() => {
      this.database
        .prepare(
          `INSERT OR REPLACE INTO session_init_requests (session_id, request) VALUES (?, ?)`,
        )
        .run(sessionId, JSON.stringify(request));
    }, "storeInitializeRequest");
  }

  /**
   * Retrieve the stored initialization request.
   * Used during session restoration to replay the original initialize request.
   */
  async getInitializeRequest(
    sessionId: string,
  ): Promise<JSONRPCMessage | undefined> {
    const row = this.database
      .prepare(`SELECT request FROM session_init_requests WHERE session_id = ?`)
      .get(sessionId) as { request: string } | undefined;
    return row ? (JSON.parse(row.request) as JSONRPCMessage) : undefined;
  }

  /**
   * Evict oldest events if the session exceeds MAX_EVENTS_PER_SESSION.
   */
  private evictOldestIfNeeded(): void {
    // Count events for this session
    const countRow = this.database
      .prepare(`SELECT COUNT(*) as count FROM mcp_events WHERE session_id = ?`)
      .get(this.sessionId) as { count: number };

    if (countRow.count <= MAX_EVENTS_PER_SESSION) {
      return;
    }

    // Delete oldest events to get back to the limit
    const toDelete = countRow.count - MAX_EVENTS_PER_SESSION;
    this.database
      .prepare(
        `DELETE FROM mcp_events WHERE event_id IN (
           SELECT event_id FROM mcp_events
           WHERE session_id = ?
           ORDER BY created_at ASC, event_id ASC
           LIMIT ?
         )`,
      )
      .run(this.sessionId, toDelete);
  }
}
