import type {
  ICapabilityStore,
  ClientCapabilities,
  ILogger,
} from "../types/interfaces.js";
import type { SQLiteDatabase } from "./sqlite-database.js";
import { BaseSQLiteStore } from "./base-sqlite-store.js";
import { safeExecute } from "./store-utils.js";

/**
 * SQLite-backed capability store for session persistence.
 * Stores session capabilities and working directories in SQLite
 * so they survive server restarts.
 *
 * NOT injectable - instantiated directly in index.ts for HTTP mode.
 */
export class SQLiteCapabilityStore
  extends BaseSQLiteStore
  implements ICapabilityStore
{
  private readonly logger: ILogger;

  constructor(db: SQLiteDatabase, logger: ILogger) {
    super(db);
    this.logger = logger;
  }

  setCapabilities(sessionId: string, caps: ClientCapabilities): void {
    safeExecute(() => {
      const now = Date.now();
      const capsJson = JSON.stringify(caps);

      // Upsert: insert or update if exists
      this.database
        .prepare(
          `INSERT INTO sessions (session_id, capabilities, created_at, last_activity)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             capabilities = excluded.capabilities,
             last_activity = excluded.last_activity`,
        )
        .run(sessionId, capsJson, now, now);

      this.logger.debug(
        `Stored capabilities for session ${sessionId}: sampling=${!!caps.sampling}, elicitation=${!!caps.elicitation}`,
      );
    }, "setCapabilities");
  }

  getCapabilities(sessionId: string): ClientCapabilities | undefined {
    return safeExecute(() => {
      const row = this.database
        .prepare(`SELECT capabilities FROM sessions WHERE session_id = ?`)
        .get(sessionId) as { capabilities: string | null } | undefined;

      if (!row?.capabilities) {
        return undefined;
      }

      this.touchSession(sessionId);

      return JSON.parse(row.capabilities) as ClientCapabilities;
    }, "getCapabilities");
  }

  hasCapability(
    sessionId: string,
    capability: "sampling" | "elicitation",
  ): boolean {
    const caps = this.getCapabilities(sessionId);
    if (!caps) return false;
    return !!caps[capability];
  }

  hasElicitationMode(sessionId: string, mode: "form" | "url"): boolean {
    const caps = this.getCapabilities(sessionId);
    if (!caps?.elicitation) return false;
    return !!caps.elicitation[mode];
  }

  deleteCapabilities(sessionId: string): void {
    safeExecute(() => {
      this.database
        .prepare(`DELETE FROM sessions WHERE session_id = ?`)
        .run(sessionId);

      this.logger.debug(`Removed capabilities for session ${sessionId}`);
    }, "deleteCapabilities");
  }

  setWorkingDirectory(sessionId: string, cwd: string): void {
    safeExecute(() => {
      const now = Date.now();

      // Upsert: insert or update if exists
      this.database
        .prepare(
          `INSERT INTO sessions (session_id, working_directory, created_at, last_activity)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             working_directory = excluded.working_directory,
             last_activity = excluded.last_activity`,
        )
        .run(sessionId, cwd, now, now);

      this.logger.debug(
        `Set working directory for session ${sessionId}: ${cwd}`,
      );
    }, "setWorkingDirectory");
  }

  getWorkingDirectory(sessionId: string): string | undefined {
    return safeExecute(() => {
      const row = this.database
        .prepare(`SELECT working_directory FROM sessions WHERE session_id = ?`)
        .get(sessionId) as { working_directory: string | null } | undefined;

      if (!row?.working_directory) {
        return undefined;
      }

      this.touchSession(sessionId);

      return row.working_directory;
    }, "getWorkingDirectory");
  }

  /**
   * Update last_activity timestamp for a session.
   * Called after read operations to track session activity.
   */
  private touchSession(sessionId: string): void {
    this.database
      .prepare(`UPDATE sessions SET last_activity = ? WHERE session_id = ?`)
      .run(Date.now(), sessionId);
  }
}
