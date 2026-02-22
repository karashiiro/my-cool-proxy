import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type {
  IExecutionLog,
  LuaExecution,
  LuaToolCall,
  ToolUsage,
} from "../types/interfaces.js";
import type { DashboardEvent } from "./types.js";
import { NotifyingExecutionLog } from "./notifying-execution-log.js";

function makeInner(): IExecutionLog {
  return {
    logExecution: vi.fn().mockReturnValue("exec-123"),
    markExecutionResult: vi.fn(),
    markExecutionError: vi.fn(),
    logToolCall: vi.fn().mockReturnValue("call-456"),
    markToolCallResult: vi.fn(),
    markToolCallError: vi.fn(),
    getExecution: vi.fn().mockReturnValue(undefined),
    getExecutions: vi.fn().mockReturnValue([]),
    getToolCalls: vi.fn().mockReturnValue([]),
    getAllExecutions: vi.fn().mockReturnValue([]),
    countExecutions: vi.fn().mockReturnValue(0),
    getDistinctTools: vi.fn().mockReturnValue([]),
  };
}

describe("NotifyingExecutionLog", () => {
  let inner: IExecutionLog;
  let onEvent: Mock<(event: DashboardEvent) => void>;
  let log: NotifyingExecutionLog;

  beforeEach(() => {
    inner = makeInner();
    onEvent = vi.fn<(event: DashboardEvent) => void>();
    log = new NotifyingExecutionLog(inner, onEvent);
  });

  describe("logExecution", () => {
    it("delegates to inner and returns its result", () => {
      const id = log.logExecution("session-1", "result(1)");
      expect(inner.logExecution).toHaveBeenCalledWith("session-1", "result(1)");
      expect(id).toBe("exec-123");
    });

    it("fires execution:new event with correct fields", () => {
      const before = Date.now();
      log.logExecution("session-1", "result(1)");
      const after = Date.now();

      expect(onEvent).toHaveBeenCalledOnce();
      const event = onEvent.mock.calls[0]![0] as Extract<
        DashboardEvent,
        { type: "execution:new" }
      >;
      expect(event.type).toBe("execution:new");
      expect(event.executionId).toBe("exec-123");
      expect(event.sessionId).toBe("session-1");
      expect(event.createdAt).toBeGreaterThanOrEqual(before);
      expect(event.createdAt).toBeLessThanOrEqual(after);
    });
  });

  describe("markExecutionResult", () => {
    it("delegates to inner", () => {
      log.markExecutionResult("exec-123", '{"ok":true}');
      expect(inner.markExecutionResult).toHaveBeenCalledWith(
        "exec-123",
        '{"ok":true}',
      );
    });

    it("fires execution:completed with status success", () => {
      log.markExecutionResult("exec-123", "null");

      expect(onEvent).toHaveBeenCalledOnce();
      const event = onEvent.mock.calls[0]![0] as Extract<
        DashboardEvent,
        { type: "execution:completed" }
      >;
      expect(event.type).toBe("execution:completed");
      expect(event.executionId).toBe("exec-123");
      expect(event.status).toBe("success");
    });
  });

  describe("markExecutionError", () => {
    it("delegates to inner", () => {
      log.markExecutionError("exec-123", "something broke");
      expect(inner.markExecutionError).toHaveBeenCalledWith(
        "exec-123",
        "something broke",
      );
    });

    it("fires execution:completed with status error", () => {
      log.markExecutionError("exec-123", "something broke");

      expect(onEvent).toHaveBeenCalledOnce();
      const event = onEvent.mock.calls[0]![0] as Extract<
        DashboardEvent,
        { type: "execution:completed" }
      >;
      expect(event.type).toBe("execution:completed");
      expect(event.executionId).toBe("exec-123");
      expect(event.status).toBe("error");
    });
  });

  describe("read methods (no events fired)", () => {
    it("getAllExecutions delegates and does not fire events", () => {
      const result: LuaExecution[] = [];
      vi.mocked(inner.getAllExecutions).mockReturnValue(result);
      const ret = log.getAllExecutions(10, 0, "server.tool");
      expect(inner.getAllExecutions).toHaveBeenCalledWith(10, 0, "server.tool");
      expect(ret).toBe(result);
      expect(onEvent).not.toHaveBeenCalled();
    });

    it("countExecutions delegates and does not fire events", () => {
      vi.mocked(inner.countExecutions).mockReturnValue(42);
      const ret = log.countExecutions("server.tool");
      expect(inner.countExecutions).toHaveBeenCalledWith("server.tool");
      expect(ret).toBe(42);
      expect(onEvent).not.toHaveBeenCalled();
    });

    it("getDistinctTools delegates and does not fire events", () => {
      const result: ToolUsage[] = [{ tool: "server.tool", count: 3 }];
      vi.mocked(inner.getDistinctTools).mockReturnValue(result);
      const ret = log.getDistinctTools();
      expect(inner.getDistinctTools).toHaveBeenCalled();
      expect(ret).toBe(result);
      expect(onEvent).not.toHaveBeenCalled();
    });

    it("getExecution delegates and does not fire events", () => {
      const execution: LuaExecution = {
        executionId: "exec-123",
        sessionId: "session-1",
        script: "result(1)",
        status: "success",
        createdAt: Date.now(),
      };
      vi.mocked(inner.getExecution).mockReturnValue(execution);
      const ret = log.getExecution("exec-123");
      expect(inner.getExecution).toHaveBeenCalledWith("exec-123");
      expect(ret).toBe(execution);
      expect(onEvent).not.toHaveBeenCalled();
    });

    it("getToolCalls delegates and does not fire events", () => {
      const calls: LuaToolCall[] = [];
      vi.mocked(inner.getToolCalls).mockReturnValue(calls);
      const ret = log.getToolCalls("exec-123");
      expect(inner.getToolCalls).toHaveBeenCalledWith("exec-123");
      expect(ret).toBe(calls);
      expect(onEvent).not.toHaveBeenCalled();
    });

    it("getExecutions delegates and does not fire events", () => {
      const executions: LuaExecution[] = [];
      vi.mocked(inner.getExecutions).mockReturnValue(executions);
      const ret = log.getExecutions("session-1", 20);
      expect(inner.getExecutions).toHaveBeenCalledWith("session-1", 20);
      expect(ret).toBe(executions);
      expect(onEvent).not.toHaveBeenCalled();
    });
  });

  describe("onEvent failure isolation", () => {
    it("logExecution still returns executionId when onEvent throws", () => {
      onEvent.mockImplementation(() => {
        throw new Error("broadcast exploded");
      });
      const id = log.logExecution("session-1", "result(1)");
      expect(id).toBe("exec-123");
      expect(inner.logExecution).toHaveBeenCalledWith("session-1", "result(1)");
    });

    it("markExecutionResult completes when onEvent throws", () => {
      onEvent.mockImplementation(() => {
        throw new Error("broadcast exploded");
      });
      expect(() => log.markExecutionResult("exec-123", "ok")).not.toThrow();
      expect(inner.markExecutionResult).toHaveBeenCalledWith("exec-123", "ok");
    });

    it("markExecutionError completes when onEvent throws", () => {
      onEvent.mockImplementation(() => {
        throw new Error("broadcast exploded");
      });
      expect(() => log.markExecutionError("exec-123", "boom")).not.toThrow();
      expect(inner.markExecutionError).toHaveBeenCalledWith("exec-123", "boom");
    });
  });

  describe("tool call methods (no events fired)", () => {
    it("logToolCall delegates and returns call ID without firing events", () => {
      const id = log.logToolCall("exec-123", "my-server", "my-tool", '{"x":1}');
      expect(inner.logToolCall).toHaveBeenCalledWith(
        "exec-123",
        "my-server",
        "my-tool",
        '{"x":1}',
      );
      expect(id).toBe("call-456");
      expect(onEvent).not.toHaveBeenCalled();
    });

    it("markToolCallResult delegates without firing events", () => {
      log.markToolCallResult("call-456", '"done"');
      expect(inner.markToolCallResult).toHaveBeenCalledWith(
        "call-456",
        '"done"',
      );
      expect(onEvent).not.toHaveBeenCalled();
    });

    it("markToolCallError delegates without firing events", () => {
      log.markToolCallError("call-456", "tool failed");
      expect(inner.markToolCallError).toHaveBeenCalledWith(
        "call-456",
        "tool failed",
      );
      expect(onEvent).not.toHaveBeenCalled();
    });
  });
});
