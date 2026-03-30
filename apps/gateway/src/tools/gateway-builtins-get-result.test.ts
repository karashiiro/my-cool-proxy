import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteDatabase } from "../stores/sqlite-database.js";
import { SQLiteExecutionLog } from "../stores/sqlite-execution-log.js";

/**
 * Tests for the getResult builtin logic.
 * This exercises the same code path as _gateway.get_result() — fetch from
 * SQLite execution log, JSON.parse, and return the parsed result.
 *
 * We test against the real SQLiteExecutionLog rather than mocking,
 * since the GatewayBuiltinsBuilder is tightly coupled to DI and
 * the actual logic is a thin wrapper around getExecutionResult + JSON.parse.
 */
describe("getResult builtin logic", () => {
  let db: SQLiteDatabase;
  let log: SQLiteExecutionLog;

  /** Simulate what GatewayBuiltinsBuilder.build() creates for getResult */
  function buildGetResult(executionLog: SQLiteExecutionLog) {
    return async (id: string) => {
      if (!id || typeof id !== "string") {
        return { error: "Missing required parameter: id" };
      }
      const resultJson = executionLog.getExecutionResult(id);
      if (resultJson === undefined) {
        return {
          error: `No result found for execution ID '${id}'. The execution may not exist or may not have produced a result.`,
        };
      }
      try {
        return JSON.parse(resultJson);
      } catch {
        return resultJson;
      }
    };
  }

  beforeEach(() => {
    db = new SQLiteDatabase(":memory:");
    log = new SQLiteExecutionLog(db);
    // Create session for FK constraint
    db.getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)`,
      )
      .run("test-session", Date.now(), Date.now());
  });

  afterEach(() => {
    db.close();
  });

  it("should return parsed JSON result for valid execution", async () => {
    const getResult = buildGetResult(log);

    const execId = log.logExecution(
      "test-session",
      "result({items = {1,2,3}})",
    );
    const stored = JSON.stringify({ items: [1, 2, 3] });
    log.markExecutionResult(execId, stored);

    const result = await getResult(execId);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it("should return error object for non-existent execution ID", async () => {
    const getResult = buildGetResult(log);

    const result = await getResult("nonexistent_12345");
    expect(result).toHaveProperty("error");
    expect(result.error).toContain("No result found");
    expect(result.error).toContain("nonexistent_12345");
  });

  it("should return error object for missing id parameter", async () => {
    const getResult = buildGetResult(log);

    const result = await getResult("" as string);
    expect(result).toHaveProperty("error");
    expect(result.error).toContain("Missing required parameter");
  });

  it("should return error for execution with no result", async () => {
    const getResult = buildGetResult(log);

    const execId = log.logExecution("test-session", "-- no result call");
    // Don't call markExecutionResult

    const result = await getResult(execId);
    expect(result).toHaveProperty("error");
    expect(result.error).toContain("No result found");
  });

  it("should return raw string when result is not valid JSON", async () => {
    const getResult = buildGetResult(log);

    const execId = log.logExecution("test-session", "result('hello')");
    // Store a non-JSON string (e.g., corrupted data)
    log.markExecutionResult(execId, "not valid json {{{");

    const result = await getResult(execId);
    expect(result).toBe("not valid json {{{");
  });

  it("should handle array results", async () => {
    const getResult = buildGetResult(log);

    const execId = log.logExecution("test-session", "result({1,2,3})");
    log.markExecutionResult(execId, JSON.stringify([1, 2, 3]));

    const result = await getResult(execId);
    expect(result).toEqual([1, 2, 3]);
  });

  it("should handle string results (JSON-encoded)", async () => {
    const getResult = buildGetResult(log);

    const execId = log.logExecution("test-session", 'result("hello")');
    log.markExecutionResult(execId, JSON.stringify("hello"));

    const result = await getResult(execId);
    expect(result).toBe("hello");
  });
});
