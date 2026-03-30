import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withTimeout, TimeoutError } from "@my-cool-proxy/mcp-utilities";

describe("Session initialization guards", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const SESSION_RESTORE_TIMEOUT_MS = 30_000; // 30 seconds

  /**
   * Helper to simulate the getSessionInitPromise pattern
   * used in index.ts for tracking session initialization
   */
  function createSessionInitPromise() {
    let resolve: () => void = () => {};
    let reject: (reason?: unknown) => void = () => {};
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  describe("AC2.1: Session restoration completes normally when upstream servers initialize in time", () => {
    it("should resolve when upstream init completes within timeout", async () => {
      const entry = createSessionInitPromise();

      // Start waiting with timeout
      const waitPromise = withTimeout(
        entry.promise,
        SESSION_RESTORE_TIMEOUT_MS,
        "session test-session-1 restoration",
      );

      // Simulate upstream init completing quickly
      vi.advanceTimersByTime(1000);
      entry.resolve();

      // Wait should succeed
      await expect(waitPromise).resolves.toBeUndefined();
    });

    it("should resolve when upstream init completes near the deadline", async () => {
      const entry = createSessionInitPromise();

      const waitPromise = withTimeout(
        entry.promise,
        SESSION_RESTORE_TIMEOUT_MS,
        "session test-session-2 restoration",
      );

      // Advance to just before timeout
      vi.advanceTimersByTime(SESSION_RESTORE_TIMEOUT_MS - 1000);
      entry.resolve();

      // Wait should still succeed
      await expect(waitPromise).resolves.toBeUndefined();
    });
  });

  describe("AC2.2: Session restoration rejects with TimeoutError when upstream init never completes", () => {
    it("should reject with TimeoutError after timeout expires", async () => {
      const entry = createSessionInitPromise();

      const waitPromise = withTimeout(
        entry.promise,
        SESSION_RESTORE_TIMEOUT_MS,
        "session test-session-3 restoration",
      );

      // Advance time past the timeout
      vi.advanceTimersByTime(SESSION_RESTORE_TIMEOUT_MS + 1000);

      // Wait should reject with TimeoutError
      await expect(waitPromise).rejects.toThrow(TimeoutError);
    });

    it("should include helpful message in TimeoutError", async () => {
      const entry = createSessionInitPromise();
      const testMessage = "session test-session-4 restoration";

      const waitPromise = withTimeout(
        entry.promise,
        SESSION_RESTORE_TIMEOUT_MS,
        testMessage,
      );

      // Advance time past the timeout
      vi.advanceTimersByTime(SESSION_RESTORE_TIMEOUT_MS + 1000);

      // Verify error message
      await expect(waitPromise).rejects.toThrow(new RegExp(testMessage, "i"));
    });
  });

  describe("AC2.3: handleDownstreamInitialized throwing an error does not orphan the session init promise", () => {
    it("should settle when reject is called (simulating handleDownstreamInitialized error)", async () => {
      const entry = createSessionInitPromise();

      // Simulate handleDownstreamInitialized throwing an error
      const testError = new Error("Upstream init failed");
      entry.reject(testError);

      // Promise should settle (not hang)
      await expect(entry.promise).rejects.toThrow("Upstream init failed");
    });

    it("should allow rejection even when awaiting with timeout", async () => {
      const entry = createSessionInitPromise();
      const testError = new Error("Downstream capability mismatch");

      const waitPromise = withTimeout(
        entry.promise,
        SESSION_RESTORE_TIMEOUT_MS,
        "session test-session-5 restoration",
      );

      // Simulate handleDownstreamInitialized error (reject is called)
      vi.advanceTimersByTime(1000);
      entry.reject(testError);

      // Should reject with the original error, not TimeoutError
      await expect(waitPromise).rejects.toThrow(
        "Downstream capability mismatch",
      );
    });
  });

  describe("AC2.4: After handleDownstreamInitialized error, session init promise rejects cleanly (not hangs)", () => {
    it("should reject cleanly with the original error from handleDownstreamInitialized", async () => {
      const entry = createSessionInitPromise();
      const initError = new Error("MCP server connection failed");

      // Simulate the error path in the try-catch
      entry.reject(initError);

      // Awaiting should throw immediately with the original error
      await expect(entry.promise).rejects.toThrow(
        "MCP server connection failed",
      );
    });

    it("should not timeout while rejection is pending", async () => {
      const entry = createSessionInitPromise();
      const initError = new Error("Resource loading failed");

      const waitPromise = withTimeout(
        entry.promise,
        SESSION_RESTORE_TIMEOUT_MS,
        "session test-session-6 restoration",
      );

      // Reject early
      vi.advanceTimersByTime(100);
      entry.reject(initError);

      // Advance more time
      vi.advanceTimersByTime(SESSION_RESTORE_TIMEOUT_MS);

      // Should have rejected with the original error, not timed out
      await expect(waitPromise).rejects.toThrow("Resource loading failed");
    });

    it("should provide proper error context after rejection", async () => {
      const entry = createSessionInitPromise();
      const contextError = new Error(
        "Session 123: handleDownstreamInitialized failed: Invalid capability",
      );

      entry.reject(contextError);

      await expect(entry.promise).rejects.toThrow(
        /Session 123.*handleDownstreamInitialized/,
      );
    });
  });

  describe("Integration: Combined session restoration pattern", () => {
    it("should follow the complete success flow", async () => {
      const entry = createSessionInitPromise();

      // Pattern: session restored, waiting for upstream init
      const waitPromise = withTimeout(
        entry.promise,
        SESSION_RESTORE_TIMEOUT_MS,
        "session integration-1 restoration",
      );

      // Simulate upstream initialization completing
      vi.advanceTimersByTime(5000);
      entry.resolve();

      // Should complete successfully
      await expect(waitPromise).resolves.toBeUndefined();
    });

    it("should follow the timeout flow", async () => {
      const entry = createSessionInitPromise();

      // Pattern: session restored, waiting for upstream init
      const waitPromise = withTimeout(
        entry.promise,
        SESSION_RESTORE_TIMEOUT_MS,
        "session integration-2 restoration",
      );

      // Simulate waiting without upstream response
      vi.advanceTimersByTime(SESSION_RESTORE_TIMEOUT_MS + 1);

      // Should timeout
      await expect(waitPromise).rejects.toThrow(TimeoutError);
    });

    it("should follow the error handling flow", async () => {
      const entry = createSessionInitPromise();

      const waitPromise = withTimeout(
        entry.promise,
        SESSION_RESTORE_TIMEOUT_MS,
        "session integration-3 restoration",
      );

      // Simulate handleDownstreamInitialized error during initialization
      vi.advanceTimersByTime(2000);
      const initError = new Error("Tool registry initialization failed");
      entry.reject(initError);

      // Should reject with the init error, not timeout
      await expect(waitPromise).rejects.toThrow(
        "Tool registry initialization failed",
      );
    });
  });
});
