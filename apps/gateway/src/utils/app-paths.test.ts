import { describe, it, expect } from "vitest";
import { APP_NAME, appPaths } from "./app-paths.js";

describe("app-paths", () => {
  it('APP_NAME equals "my-cool-proxy"', () => {
    expect(APP_NAME).toBe("my-cool-proxy");
  });

  it("appPaths has expected property names", () => {
    expect(appPaths).toEqual(
      expect.objectContaining({
        data: expect.any(String),
        config: expect.any(String),
        cache: expect.any(String),
        log: expect.any(String),
        temp: expect.any(String),
      }),
    );
  });

  it.each(["data", "config", "cache", "log", "temp"] as const)(
    "appPaths.%s is a non-empty string",
    (key) => {
      const value = appPaths[key];
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    },
  );

  it.each(["data", "config", "cache", "log", "temp"] as const)(
    'appPaths.%s contains "my-cool-proxy" in the path',
    (key) => {
      expect(appPaths[key]).toContain("my-cool-proxy");
    },
  );

  it("appPaths is a stable singleton reference across repeated imports", async () => {
    const { appPaths: secondImport } = await import("./app-paths.js");
    expect(secondImport).toBe(appPaths);
  });
});
