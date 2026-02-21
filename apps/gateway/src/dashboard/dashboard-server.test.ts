import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDashboardApp } from "./dashboard-server.js";
import { SQLiteDatabase } from "../stores/sqlite-database.js";
import { SQLiteExecutionLog } from "../stores/sqlite-execution-log.js";
import type { LuaExecution, LuaToolCall } from "../types/interfaces.js";

describe("Dashboard API", () => {
  let db: SQLiteDatabase;
  let log: SQLiteExecutionLog;
  let app: ReturnType<typeof createDashboardApp>;

  beforeEach(() => {
    db = new SQLiteDatabase(":memory:");
    log = new SQLiteExecutionLog(db);
    // Static dir doesn't matter for API tests
    app = createDashboardApp(log, "/nonexistent");
  });

  afterEach(() => {
    db.close();
  });

  describe("GET /api/executions", () => {
    it("should return empty array when no executions exist", async () => {
      const res = await app.request("/api/executions");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("should return executions ordered by created_at DESC", async () => {
      log.logExecution("s1", "script1");
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.logExecution("s2", "script2");

      const res = await app.request("/api/executions");
      const data = (await res.json()) as LuaExecution[];
      expect(data).toHaveLength(2);
      expect(data[0]!.script).toBe("script2");
      expect(data[1]!.script).toBe("script1");
    });

    it("should respect limit query param", async () => {
      for (let i = 0; i < 10; i++) {
        log.logExecution("s", `s${i}`);
      }
      const res = await app.request("/api/executions?limit=3");
      expect((await res.json()) as LuaExecution[]).toHaveLength(3);
    });

    it("should clamp limit to valid range", async () => {
      for (let i = 0; i < 5; i++) {
        log.logExecution("s", `s${i}`);
      }
      // Negative limit gets clamped to 1
      const res1 = await app.request("/api/executions?limit=-5");
      expect((await res1.json()) as LuaExecution[]).toHaveLength(1);

      // NaN limit falls back to 50
      const res2 = await app.request("/api/executions?limit=abc");
      expect((await res2.json()) as LuaExecution[]).toHaveLength(5);
    });

    it("should return executions across all sessions", async () => {
      log.logExecution("session-a", "script-a");
      log.logExecution("session-b", "script-b");
      log.logExecution("session-c", "script-c");

      const res = await app.request("/api/executions");
      const data = (await res.json()) as LuaExecution[];
      expect(data).toHaveLength(3);
    });
  });

  describe("GET /api/executions/:id", () => {
    it("should return 404 for non-existent execution", async () => {
      const res = await app.request("/api/executions/nonexistent");
      expect(res.status).toBe(404);
    });

    it("should return execution details", async () => {
      const id = log.logExecution("s1", "result(42)");
      log.markExecutionResult(id, "42");

      const res = await app.request(`/api/executions/${id}`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as LuaExecution;
      expect(data.executionId).toBe(id);
      expect(data.result).toBe("42");
      expect(data.script).toBe("result(42)");
    });

    it("should return execution with error status", async () => {
      const id = log.logExecution("s1", "bad()");
      log.markExecutionError(id, "attempt to call a nil value");

      const res = await app.request(`/api/executions/${id}`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as LuaExecution;
      expect(data.status).toBe("error");
      expect(data.error).toBe("attempt to call a nil value");
    });
  });

  describe("GET /api/executions/:id/tool-calls", () => {
    it("should return tool calls for an execution", async () => {
      const execId = log.logExecution("s1", "server.tool():await()");
      const callId = log.logToolCall(execId, "server", "tool", '{"key":"val"}');
      log.markToolCallResult(callId, '{"content":[]}');

      const res = await app.request(`/api/executions/${execId}/tool-calls`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as LuaToolCall[];
      expect(data).toHaveLength(1);
      expect(data[0]!.serverName).toBe("server");
      expect(data[0]!.toolName).toBe("tool");
      expect(data[0]!.arguments).toBe('{"key":"val"}');
    });

    it("should return empty array for execution with no tool calls", async () => {
      const execId = log.logExecution("s1", "result(1)");
      const res = await app.request(`/api/executions/${execId}/tool-calls`);
      expect((await res.json()) as LuaToolCall[]).toEqual([]);
    });

    it("should return 404 for non-existent execution", async () => {
      const res = await app.request("/api/executions/nonexistent/tool-calls");
      expect(res.status).toBe(404);
    });

    it("should return multiple tool calls in order", async () => {
      const execId = log.logExecution("s1", "multi-call script");
      log.logToolCall(execId, "server", "first-tool");
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.logToolCall(execId, "server", "second-tool");

      const res = await app.request(`/api/executions/${execId}/tool-calls`);
      const data = (await res.json()) as LuaToolCall[];
      expect(data).toHaveLength(2);
      // Descending order
      expect(data[0]!.toolName).toBe("second-tool");
      expect(data[1]!.toolName).toBe("first-tool");
    });
  });
});
