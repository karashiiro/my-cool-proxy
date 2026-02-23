import { describe, it, expect } from "vitest";
import { BaseSQLiteStore } from "./base-sqlite-store.js";
import type { SQLiteDatabase } from "./sqlite-database.js";
import type Database from "better-sqlite3";

// Concrete subclass for testing the abstract base
class TestStore extends BaseSQLiteStore {
  getExposedDatabase(): Database.Database {
    return this.database;
  }
}

describe("BaseSQLiteStore", () => {
  it("exposes the database from the SQLiteDatabase wrapper", () => {
    const fakeDb = { fake: true } as unknown as Database.Database;
    const fakeSqliteDatabase = {
      getDatabase: () => fakeDb,
    } as unknown as SQLiteDatabase;

    const store = new TestStore(fakeSqliteDatabase);
    expect(store.getExposedDatabase()).toBe(fakeDb);
  });
});
