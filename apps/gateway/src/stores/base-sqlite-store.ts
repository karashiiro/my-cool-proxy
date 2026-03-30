import type { SQLiteDatabase } from "./sqlite-database.js";
import type Database from "better-sqlite3";

/**
 * Base class for SQLite-backed stores.
 * Provides shared database access and utility methods.
 */
export abstract class BaseSQLiteStore {
  protected readonly database: Database.Database;

  constructor(protected readonly db: SQLiteDatabase) {
    this.database = db.getDatabase();
  }
}
