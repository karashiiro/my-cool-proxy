import type { IToolInspectionStore } from "../types/interfaces.js";
import type { SQLiteDatabase } from "./sqlite-database.js";
import { BaseSQLiteStore } from "./base-sqlite-store.js";
import { safeExecute } from "./store-utils.js";

/**
 * SQLite-backed tool inspection store for session persistence.
 * Tracks which tools have been inspected (via tool-details or inspect-tool-response)
 * per session, so that state survives gateway restarts.
 *
 * NOT injectable — instantiated directly in startup.ts.
 */
export class SQLiteToolInspectionStore
  extends BaseSQLiteStore
  implements IToolInspectionStore
{
  constructor(db: SQLiteDatabase) {
    super(db);
  }

  markInspected(
    sessionId: string,
    luaServerName: string,
    luaToolName: string,
  ): void {
    safeExecute(() => {
      const toolKey = `${luaServerName}.${luaToolName}`;
      this.database
        .prepare(
          `INSERT OR IGNORE INTO tool_inspections (session_id, tool_key, created_at)
           VALUES (?, ?, ?)`,
        )
        .run(sessionId, toolKey, Date.now());
    }, "markInspected");
  }

  isInspected(
    sessionId: string,
    luaServerName: string,
    luaToolName: string,
  ): boolean {
    return safeExecute(() => {
      const toolKey = `${luaServerName}.${luaToolName}`;
      const row = this.database
        .prepare(
          `SELECT 1 FROM tool_inspections WHERE session_id = ? AND tool_key = ?`,
        )
        .get(sessionId, toolKey);
      return row !== undefined;
    }, "isInspected");
  }

  deleteSession(sessionId: string): void {
    safeExecute(() => {
      this.database
        .prepare(`DELETE FROM tool_inspections WHERE session_id = ?`)
        .run(sessionId);
    }, "deleteSession");
  }
}
