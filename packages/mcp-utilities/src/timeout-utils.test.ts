import { describe, it, expect, vi } from "vitest";
import { TimeoutError, withTimeout } from "./timeout-utils.js";

describe("TimeoutError", () => {
  it("should create an error with correct message format (AC1.2)", () => {
    const error = new TimeoutError("test operation", 5000);
    expect(error.message).toBe("test operation timed out after 5000ms");
  });

  it("should have correct name property (AC1.2)", () => {
    const error = new TimeoutError("test operation", 5000);
    expect(error.name).toBe("TimeoutError");
  });

  it("should have correct label property (AC1.2)", () => {
    const error = new TimeoutError("test operation", 5000);
    expect(error.label).toBe("test operation");
  });

  it("should have correct ms property (AC1.2)", () => {
    const error = new TimeoutError("test operation", 5000);
    expect(error.ms).toBe(5000);
  });

  it("should be instanceof Error", () => {
    const error = new TimeoutError("test operation", 5000);
    expect(error).toBeInstanceOf(Error);
  });

  it("should be instanceof TimeoutError", () => {
    const error = new TimeoutError("test operation", 5000);
    expect(error).toBeInstanceOf(TimeoutError);
  });
});

describe("withTimeout", () => {
  it("should return resolved value when promise resolves before timeout (AC1.1)", async () => {
    vi.useFakeTimers();
    try {
      const resolvedValue = "success";
      const promise = Promise.resolve(resolvedValue);
      const wrapped = withTimeout(promise, 5000, "test");

      const result = await wrapped;
      expect(result).toBe(resolvedValue);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should reject with TimeoutError when promise does not resolve in time (AC1.3)", async () => {
    vi.useFakeTimers();
    try {
      const promise = new Promise(() => {
        // Never resolves
      });
      const wrapped = withTimeout(promise, 5000, "test operation");

      const timeoutPromise = wrapped;
      vi.advanceTimersByTime(5000);

      await expect(timeoutPromise).rejects.toThrow(TimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should reject with TimeoutError containing correct label and ms (AC1.3)", async () => {
    vi.useFakeTimers();
    try {
      const promise = new Promise(() => {
        // Never resolves
      });
      const label = "database query";
      const ms = 3000;
      const wrapped = withTimeout(promise, ms, label);

      vi.advanceTimersByTime(ms);

      try {
        await wrapped;
        throw new Error("Expected TimeoutError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        if (error instanceof TimeoutError) {
          expect(error.label).toBe(label);
          expect(error.ms).toBe(ms);
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("should propagate original error when promise rejects (AC1.4)", async () => {
    vi.useFakeTimers();
    try {
      const originalError = new Error("original failure");
      const promise = Promise.reject(originalError);
      const wrapped = withTimeout(promise, 5000, "test");

      await expect(wrapped).rejects.toBe(originalError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should not wrap non-timeout errors in TimeoutError (AC1.4)", async () => {
    vi.useFakeTimers();
    try {
      const originalError = new Error("connection failed");
      const promise = Promise.reject(originalError);
      const wrapped = withTimeout(promise, 5000, "test");

      try {
        await wrapped;
        throw new Error("Expected error to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(TimeoutError);
        expect(error).toBe(originalError);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("should clear timeout when promise resolves before deadline", async () => {
    vi.useFakeTimers();
    try {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      const promise = Promise.resolve("value");
      const wrapped = withTimeout(promise, 5000, "test");

      await wrapped;

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("should clear timeout when promise rejects before deadline", async () => {
    vi.useFakeTimers();
    try {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      const error = new Error("failure");
      const promise = Promise.reject(error);
      const wrapped = withTimeout(promise, 5000, "test");

      try {
        await wrapped;
      } catch {
        // Expected to fail
      }

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("should preserve promise value type through timeout wrapper", async () => {
    vi.useFakeTimers();
    try {
      const testObject = { id: 123, name: "test", nested: { value: true } };
      const promise = Promise.resolve(testObject);
      const wrapped = withTimeout(promise, 5000, "test");

      const result = await wrapped;
      expect(result).toEqual(testObject);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should handle promises that resolve with undefined", async () => {
    vi.useFakeTimers();
    try {
      const promise = Promise.resolve(undefined);
      const wrapped = withTimeout(promise, 5000, "test");

      const result = await wrapped;
      expect(result).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
