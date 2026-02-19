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
