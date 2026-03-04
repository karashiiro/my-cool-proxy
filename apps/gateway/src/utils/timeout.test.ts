import { describe, it, expect } from "vitest";
import { withTimeout } from "./timeout.js";

describe("withTimeout", () => {
  it("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000, "timed out");
    expect(result).toBe("ok");
  });

  it("rejects with the provided message when timeout fires first", async () => {
    const neverResolves = new Promise<string>(() => {});
    await expect(
      withTimeout(neverResolves, 10, "custom timeout message"),
    ).rejects.toThrow("custom timeout message");
  });

  it("propagates the original rejection when promise rejects before timeout", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("original")), 1000, "timed out"),
    ).rejects.toThrow("original");
  });
});
