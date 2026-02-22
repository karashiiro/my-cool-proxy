import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDashboardApp } from "./dashboard-server.js";
import { SQLiteDatabase } from "../stores/sqlite-database.js";
import { SQLiteExecutionLog } from "../stores/sqlite-execution-log.js";
import type { IMCPClientManager } from "@my-cool-proxy/mcp-client";
import type {
  ICapabilityStore,
  LuaExecution,
  LuaToolCall,
  ToolUsage,
} from "../types/interfaces.js";
import type { SessionInfo } from "./types.js";

interface ExecutionsResponse {
  executions: LuaExecution[];
  total: number;
}

const mockClientManager = {
  getActiveSessions: () => [] as string[],
  getClientsBySession: () => new Map(),
  getFailedServers: () => new Map(),
} as unknown as IMCPClientManager;

const mockCapabilityStore = {
  getCapabilities: () => undefined,
  getWorkingDirectory: () => undefined,
} as unknown as ICapabilityStore;

describe("Dashboard API", () => {
  let db: SQLiteDatabase;
  let log: SQLiteExecutionLog;
  let app: ReturnType<typeof createDashboardApp>;

  beforeEach(() => {
    db = new SQLiteDatabase(":memory:");
    log = new SQLiteExecutionLog(db);
    // Static dir doesn't matter for API tests
    app = createDashboardApp(
      log,
      mockClientManager,
      mockCapabilityStore,
      db,
      "/nonexistent",
    );
  });

  afterEach(() => {
    db.close();
  });

  describe("GET /api/executions", () => {
    it("should return empty array when no executions exist", async () => {
      const res = await app.request("/api/executions");
      expect(res.status).toBe(200);
      const data = (await res.json()) as ExecutionsResponse;
      expect(data.executions).toEqual([]);
      expect(data.total).toBe(0);
    });

    it("should return executions ordered by created_at DESC", async () => {
      log.logExecution("s1", "script1");
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.logExecution("s2", "script2");

      const res = await app.request("/api/executions");
      const data = (await res.json()) as ExecutionsResponse;
      expect(data.executions).toHaveLength(2);
      expect(data.total).toBe(2);
      expect(data.executions[0]!.script).toBe("script2");
      expect(data.executions[1]!.script).toBe("script1");
    });

    it("should respect limit query param", async () => {
      for (let i = 0; i < 10; i++) {
        log.logExecution("s", `s${i}`);
      }
      const res = await app.request("/api/executions?limit=3");
      const data = (await res.json()) as ExecutionsResponse;
      expect(data.executions).toHaveLength(3);
      expect(data.total).toBe(10);
    });

    it("should respect offset query param", async () => {
      // Inserts happen in a tight synchronous loop so all rows share the same
      // Date.now() timestamp. The ORDER BY uses `created_at DESC, rowid DESC`
      // so rows are ordered by insertion order (highest rowid = most recent).
      // s9 is most recent, s0 is oldest. Offset 3 skips s9, s8, s7.
      for (let i = 0; i < 10; i++) {
        log.logExecution("s", `s${i}`);
      }
      const res = await app.request("/api/executions?limit=3&offset=3");
      const data = (await res.json()) as ExecutionsResponse;
      expect(data.executions).toHaveLength(3);
      expect(data.total).toBe(10);
      expect(data.executions[0]!.script).toBe("s6");
    });

    it("should clamp limit to valid range", async () => {
      for (let i = 0; i < 5; i++) {
        log.logExecution("s", `s${i}`);
      }
      // Negative limit gets clamped to 1
      const res1 = await app.request("/api/executions?limit=-5");
      const data1 = (await res1.json()) as ExecutionsResponse;
      expect(data1.executions).toHaveLength(1);

      // NaN limit falls back to 50
      const res2 = await app.request("/api/executions?limit=abc");
      const data2 = (await res2.json()) as ExecutionsResponse;
      expect(data2.executions).toHaveLength(5);
    });

    it("should filter executions by tool query param", async () => {
      const exec1 = log.logExecution("s", "script1");
      log.logToolCall(exec1, "github", "search_code");
      const exec2 = log.logExecution("s", "script2");
      log.logToolCall(exec2, "github", "list_issues");
      const exec3 = log.logExecution("s", "script3");
      log.logToolCall(exec3, "github", "search_code");

      const res = await app.request("/api/executions?tool=github.search_code");
      const data = (await res.json()) as ExecutionsResponse;
      expect(data.executions).toHaveLength(2);
      expect(data.total).toBe(2);
      expect(data.executions.map((e) => e.script)).toContain("script1");
      expect(data.executions.map((e) => e.script)).toContain("script3");
    });

    it("should return empty results for non-existent tool filter", async () => {
      const exec1 = log.logExecution("s", "script1");
      log.logToolCall(exec1, "github", "search_code");

      const res = await app.request("/api/executions?tool=nonexistent.tool");
      const data = (await res.json()) as ExecutionsResponse;
      expect(data.executions).toEqual([]);
      expect(data.total).toBe(0);
    });

    it("should return executions across all sessions", async () => {
      log.logExecution("session-a", "script-a");
      log.logExecution("session-b", "script-b");
      log.logExecution("session-c", "script-c");

      const res = await app.request("/api/executions");
      const data = (await res.json()) as ExecutionsResponse;
      expect(data.executions).toHaveLength(3);
      expect(data.total).toBe(3);
    });
  });

  describe("GET /api/tools", () => {
    it("should return empty array when no tool calls exist", async () => {
      const res = await app.request("/api/tools");
      expect(res.status).toBe(200);
      expect((await res.json()) as ToolUsage[]).toEqual([]);
    });

    it("should return distinct tools ordered by count descending", async () => {
      const exec1 = log.logExecution("s", "a");
      log.logToolCall(exec1, "github", "search_code");
      log.logToolCall(exec1, "github", "search_code");
      const exec2 = log.logExecution("s", "b");
      log.logToolCall(exec2, "context7", "query_docs");
      log.logToolCall(exec2, "context7", "query_docs");
      log.logToolCall(exec2, "context7", "query_docs");
      log.logToolCall(exec2, "github", "list_issues");

      const res = await app.request("/api/tools");
      const data = (await res.json()) as ToolUsage[];
      expect(data).toHaveLength(3);
      expect(data[0]).toEqual({ tool: "context7.query_docs", count: 3 });
      expect(data[1]).toEqual({ tool: "github.search_code", count: 2 });
      expect(data[2]).toEqual({ tool: "github.list_issues", count: 1 });
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

  describe("GET /api/sessions", () => {
    it("should return empty array when no active sessions", async () => {
      const res = await app.request("/api/sessions");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("should return session info with connected servers", async () => {
      // Create a custom app with a mock that returns sessions
      const clientMgr = {
        getActiveSessions: () => ["session-1"],
        getClientsBySession: () =>
          new Map([
            ["github", {} as unknown],
            ["context7", {} as unknown],
          ]),
        getFailedServers: () => new Map(),
      } as unknown as IMCPClientManager;

      const capStore = {
        getCapabilities: () => ({
          sampling: {},
          roots: { listChanged: true },
        }),
        getWorkingDirectory: () => "/tmp/test",
      } as unknown as ICapabilityStore;

      // Insert a session row in the SQLite sessions table for timestamps
      db.getDatabase()
        .prepare(
          "INSERT OR REPLACE INTO sessions (session_id, created_at, last_activity) VALUES (?, ?, ?)",
        )
        .run("session-1", 1000, 2000);

      const customApp = createDashboardApp(
        log,
        clientMgr,
        capStore,
        db,
        "/nonexistent",
      );
      const res = await customApp.request("/api/sessions");
      const data = (await res.json()) as SessionInfo[];

      expect(data).toHaveLength(1);
      expect(data[0]!.sessionId).toBe("session-1");
      expect(data[0]!.connectedServers).toEqual(["github", "context7"]);
      expect(data[0]!.capabilities.sampling).toBe(true);
      expect(data[0]!.capabilities.roots).toBe(true);
      expect(data[0]!.capabilities.elicitation).toBe(false);
      expect(data[0]!.workingDirectory).toBe("/tmp/test");
      expect(data[0]!.createdAt).toBe(1000);
      expect(data[0]!.lastActivity).toBe(2000);
    });

    it("should include failed servers", async () => {
      const clientMgr = {
        getActiveSessions: () => ["session-2"],
        getClientsBySession: () => new Map([["github", {} as unknown]]),
        getFailedServers: () =>
          new Map([["broken-server", "Connection refused"]]),
      } as unknown as IMCPClientManager;

      const capStore = {
        getCapabilities: () => undefined,
        getWorkingDirectory: () => undefined,
      } as unknown as ICapabilityStore;

      const customApp = createDashboardApp(
        log,
        clientMgr,
        capStore,
        db,
        "/nonexistent",
      );
      const res = await customApp.request("/api/sessions");
      const data = (await res.json()) as SessionInfo[];

      expect(data[0]!.failedServers).toEqual([
        { name: "broken-server", error: "Connection refused" },
      ]);
    });
  });
});
