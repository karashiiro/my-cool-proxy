import { describe, it, expect, vi } from "vitest";
import { generateTimeId, safeExecute } from "./store-utils.js";

describe("generateTimeId", () => {
  it("returns a string in {timestamp}_{random} format", () => {
    const id = generateTimeId();
    expect(id).toMatch(/^\d+_[a-z0-9]+$/);
  });

  it("produces unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTimeId()));
    expect(ids.size).toBe(100);
  });

  it("embeds the current timestamp", () => {
    const before = Date.now();
    const id = generateTimeId();
    const after = Date.now();
    const timestamp = Number(id.split("_")[0]);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe("safeExecute", () => {
  it("returns the operation result on success", () => {
    const result = safeExecute(() => 42, "test-op");
    expect(result).toBe(42);
  });

  it("wraps Error instances with context", () => {
    expect(() =>
      safeExecute(() => {
        throw new Error("disk full");
      }, "insert"),
    ).toThrow("SQLite error in insert: disk full");
  });

  it("wraps non-Error throws with context", () => {
    expect(() =>
      safeExecute(() => {
        throw "string error";
      }, "update"),
    ).toThrow("SQLite error in update: string error");
  });

  it("does not catch errors from outside the operation", () => {
    const result = safeExecute(() => "ok", "noop");
    expect(result).toBe("ok");
  });
});
