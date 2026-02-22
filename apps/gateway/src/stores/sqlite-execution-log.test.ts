import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteDatabase } from "./sqlite-database.js";
import { SQLiteExecutionLog } from "./sqlite-execution-log.js";

describe("SQLiteExecutionLog", () => {
  let db: SQLiteDatabase;
  let log: SQLiteExecutionLog;

  beforeEach(() => {
    db = new SQLiteDatabase(":memory:");
    log = new SQLiteExecutionLog(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("logExecution", () => {
    it("should insert an execution record and return an ID", () => {
      const id = log.logExecution("session-1", "result(1 + 1)");
      expect(id).toBeTruthy();
      expect(id).toContain("_"); // timestamp_random format
    });

    it("should record status as success by default", () => {
      const id = log.logExecution("session-1", "result(1)");
      const executions = log.getExecutions("session-1");
      expect(executions).toHaveLength(1);
      expect(executions[0]!.executionId).toBe(id);
      expect(executions[0]!.status).toBe("success");
      expect(executions[0]!.error).toBeNull();
    });
  });

  describe("markExecutionError", () => {
    it("should update status to error with message", () => {
      const id = log.logExecution("session-1", "bad()");
      log.markExecutionError(id, "attempt to call a nil value");

      const executions = log.getExecutions("session-1");
      expect(executions[0]!.status).toBe("error");
      expect(executions[0]!.error).toBe("attempt to call a nil value");
    });
  });

  describe("logToolCall", () => {
    it("should insert a tool call linked to an execution", () => {
      const execId = log.logExecution("session-1", "server.tool():await()");
      const callId = log.logToolCall(
        execId,
        "my-server",
        "my-tool",
        '{"key":"value"}',
      );

      expect(callId).toBeTruthy();

      const calls = log.getToolCalls(execId);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.callId).toBe(callId);
      expect(calls[0]!.executionId).toBe(execId);
      expect(calls[0]!.serverName).toBe("my-server");
      expect(calls[0]!.toolName).toBe("my-tool");
      expect(calls[0]!.arguments).toBe('{"key":"value"}');
      expect(calls[0]!.status).toBe("success");
    });

    it("should allow null arguments", () => {
      const execId = log.logExecution("session-1", "script");
      log.logToolCall(execId, "server", "tool");

      const calls = log.getToolCalls(execId);
      expect(calls[0]!.arguments).toBeNull();
    });
  });

  describe("markToolCallError", () => {
    it("should update tool call status to error", () => {
      const execId = log.logExecution("session-1", "script");
      const callId = log.logToolCall(execId, "server", "tool");
      log.markToolCallError(callId, "connection refused");

      const calls = log.getToolCalls(execId);
      expect(calls[0]!.status).toBe("error");
      expect(calls[0]!.error).toBe("connection refused");
    });
  });

  describe("markExecutionResult", () => {
    it("should store the final script result", () => {
      const id = log.logExecution("session-1", "result(42)");
      log.markExecutionResult(id, "42");

      const executions = log.getExecutions("session-1");
      expect(executions[0]!.result).toBe("42");
    });

    it("should store JSON-serialized object results", () => {
      const id = log.logExecution("session-1", 'result({key = "val"})');
      const resultJson = JSON.stringify({ key: "val" });
      log.markExecutionResult(id, resultJson);

      const executions = log.getExecutions("session-1");
      expect(executions[0]!.result).toBe(resultJson);
    });

    it("should leave result null when not set", () => {
      log.logExecution("session-1", "-- no result");

      const executions = log.getExecutions("session-1");
      expect(executions[0]!.result).toBeNull();
    });
  });

  describe("markToolCallResult", () => {
    it("should store the tool call result", () => {
      const execId = log.logExecution("session-1", "script");
      const callId = log.logToolCall(execId, "server", "tool");
      const resultJson = JSON.stringify({
        content: [{ type: "text", text: "hello" }],
      });
      log.markToolCallResult(callId, resultJson);

      const calls = log.getToolCalls(execId);
      expect(calls[0]!.result).toBe(resultJson);
    });

    it("should leave result null when not set", () => {
      const execId = log.logExecution("session-1", "script");
      log.logToolCall(execId, "server", "tool");

      const calls = log.getToolCalls(execId);
      expect(calls[0]!.result).toBeNull();
    });
  });

  describe("getExecutions", () => {
    it("should return executions in descending order by timestamp", async () => {
      log.logExecution("session-1", "first");
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.logExecution("session-1", "second");
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.logExecution("session-1", "third");

      const executions = log.getExecutions("session-1");
      expect(executions).toHaveLength(3);
      expect(executions[0]!.script).toBe("third");
      expect(executions[1]!.script).toBe("second");
      expect(executions[2]!.script).toBe("first");
    });

    it("should only return executions for the requested session", () => {
      log.logExecution("session-1", "script-a");
      log.logExecution("session-2", "script-b");

      const s1 = log.getExecutions("session-1");
      expect(s1).toHaveLength(1);
      expect(s1[0]!.script).toBe("script-a");

      const s2 = log.getExecutions("session-2");
      expect(s2).toHaveLength(1);
      expect(s2[0]!.script).toBe("script-b");
    });

    it("should respect the limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        log.logExecution("session-1", `script-${i}`);
      }

      const executions = log.getExecutions("session-1", 3);
      expect(executions).toHaveLength(3);
    });

    it("should return an empty array for unknown sessions", () => {
      const executions = log.getExecutions("nonexistent");
      expect(executions).toEqual([]);
    });
  });

  describe("getExecution", () => {
    it("should return a single execution by ID", () => {
      const id = log.logExecution("session-1", "result('hello')");
      log.markExecutionResult(id, JSON.stringify("hello"));
      const execution = log.getExecution(id);
      expect(execution).toBeDefined();
      expect(execution!.executionId).toBe(id);
      expect(execution!.script).toBe("result('hello')");
      expect(execution!.status).toBe("success");
    });

    it("should return undefined for non-existent execution", () => {
      expect(log.getExecution("nonexistent")).toBeUndefined();
    });

    it("should return execution with error status", () => {
      const id = log.logExecution("session-1", "bad()");
      log.markExecutionError(id, "attempt to call a nil value");
      const execution = log.getExecution(id);
      expect(execution).toBeDefined();
      expect(execution!.status).toBe("error");
      expect(execution!.error).toBe("attempt to call a nil value");
    });
  });

  describe("getAllExecutions", () => {
    it("should return executions across all sessions ordered by created_at DESC", async () => {
      log.logExecution("session-1", "script1");
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.logExecution("session-2", "script2");
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.logExecution("session-1", "script3");

      const all = log.getAllExecutions();
      expect(all).toHaveLength(3);
      // Most recent first
      expect(all[0]!.script).toBe("script3");
      expect(all[2]!.script).toBe("script1");
    });

    it("should respect limit parameter", () => {
      for (let i = 0; i < 10; i++) log.logExecution("s", `script${i}`);
      expect(log.getAllExecutions(3)).toHaveLength(3);
    });

    it("should default limit to 50", () => {
      for (let i = 0; i < 60; i++) log.logExecution("s", `script${i}`);
      expect(log.getAllExecutions()).toHaveLength(50);
    });

    it("should return empty array when no executions exist", () => {
      expect(log.getAllExecutions()).toEqual([]);
    });

    it("should filter by tool when toolFilter is provided", () => {
      const exec1 = log.logExecution("s", "script1");
      log.logToolCall(exec1, "github", "search_code");
      const exec2 = log.logExecution("s", "script2");
      log.logToolCall(exec2, "github", "list_issues");
      const exec3 = log.logExecution("s", "script3");
      log.logToolCall(exec3, "github", "search_code");

      const filtered = log.getAllExecutions(50, 0, "github.search_code");
      expect(filtered).toHaveLength(2);
      // Most recent first
      expect(filtered[0]!.script).toBe("script3");
      expect(filtered[1]!.script).toBe("script1");
    });

    it("should return empty array when toolFilter matches nothing", () => {
      const exec1 = log.logExecution("s", "script1");
      log.logToolCall(exec1, "github", "search_code");
      expect(log.getAllExecutions(50, 0, "nonexistent.tool")).toEqual([]);
    });

    it("should not duplicate executions with multiple calls to the same tool", () => {
      const exec1 = log.logExecution("s", "script1");
      log.logToolCall(exec1, "github", "search_code");
      log.logToolCall(exec1, "github", "search_code");
      const filtered = log.getAllExecutions(50, 0, "github.search_code");
      expect(filtered).toHaveLength(1);
    });

    it("should respect offset parameter", () => {
      for (let i = 0; i < 10; i++) log.logExecution("s", `script${i}`);
      // rowid DESC tiebreaker: script9 is most recent, skip first 3
      const page = log.getAllExecutions(3, 3);
      expect(page).toHaveLength(3);
      expect(page[0]!.script).toBe("script6");
    });
  });

  describe("countExecutions", () => {
    it("should return 0 when no executions exist", () => {
      expect(log.countExecutions()).toBe(0);
    });

    it("should return the total number of executions", () => {
      log.logExecution("s1", "a");
      log.logExecution("s2", "b");
      log.logExecution("s1", "c");
      expect(log.countExecutions()).toBe(3);
    });

    it("should count only filtered executions when toolFilter is provided", () => {
      const exec1 = log.logExecution("s", "a");
      log.logToolCall(exec1, "github", "search_code");
      const exec2 = log.logExecution("s", "b");
      log.logToolCall(exec2, "github", "list_issues");
      const exec3 = log.logExecution("s", "c");
      log.logToolCall(exec3, "github", "search_code");
      expect(log.countExecutions("github.search_code")).toBe(2);
      expect(log.countExecutions("github.list_issues")).toBe(1);
      expect(log.countExecutions("nonexistent.tool")).toBe(0);
    });
  });

  describe("getDistinctTools", () => {
    it("should return empty array when no tool calls exist", () => {
      expect(log.getDistinctTools()).toEqual([]);
    });

    it("should return distinct tools ordered by count descending", () => {
      const exec1 = log.logExecution("s", "a");
      log.logToolCall(exec1, "github", "search_code");
      log.logToolCall(exec1, "github", "search_code");
      log.logToolCall(exec1, "github", "list_issues");
      const exec2 = log.logExecution("s", "b");
      log.logToolCall(exec2, "context7", "query_docs");
      log.logToolCall(exec2, "context7", "query_docs");
      log.logToolCall(exec2, "context7", "query_docs");

      const tools = log.getDistinctTools();
      expect(tools).toHaveLength(3);
      // context7.query_docs has 3 calls (most)
      expect(tools[0]).toEqual({ tool: "context7.query_docs", count: 3 });
      // github.search_code has 2 calls
      expect(tools[1]).toEqual({ tool: "github.search_code", count: 2 });
      // github.list_issues has 1 call
      expect(tools[2]).toEqual({ tool: "github.list_issues", count: 1 });
    });
  });

  describe("getToolCalls", () => {
    it("should return tool calls in descending order by timestamp", async () => {
      const execId = log.logExecution("session-1", "multi-call script");
      log.logToolCall(execId, "server", "first-tool");
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.logToolCall(execId, "server", "second-tool");
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.logToolCall(execId, "server", "third-tool");

      const calls = log.getToolCalls(execId);
      expect(calls).toHaveLength(3);
      expect(calls[0]!.toolName).toBe("third-tool");
      expect(calls[1]!.toolName).toBe("second-tool");
      expect(calls[2]!.toolName).toBe("first-tool");
    });

    it("should only return tool calls for the requested execution", () => {
      const exec1 = log.logExecution("session-1", "script-1");
      const exec2 = log.logExecution("session-1", "script-2");
      log.logToolCall(exec1, "server", "tool-a");
      log.logToolCall(exec2, "server", "tool-b");

      const calls1 = log.getToolCalls(exec1);
      expect(calls1).toHaveLength(1);
      expect(calls1[0]!.toolName).toBe("tool-a");

      const calls2 = log.getToolCalls(exec2);
      expect(calls2).toHaveLength(1);
      expect(calls2[0]!.toolName).toBe("tool-b");
    });

    it("should return an empty array for unknown executions", () => {
      const calls = log.getToolCalls("nonexistent");
      expect(calls).toEqual([]);
    });
  });
});
