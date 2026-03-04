import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { isSafePathComponent, resolveAndValidate } from "./path-validator.js";

describe("isSafePathComponent", () => {
  it("returns true for a simple name", () => {
    expect(isSafePathComponent("my-skill")).toBe(true);
  });

  it("returns true for names with dots", () => {
    expect(isSafePathComponent("file.txt")).toBe(true);
  });

  it("returns false for forward slash", () => {
    expect(isSafePathComponent("../escape")).toBe(false);
  });

  it("returns false for backslash", () => {
    expect(isSafePathComponent("..\\escape")).toBe(false);
  });

  it("returns true for empty string", () => {
    expect(isSafePathComponent("")).toBe(true);
  });
});

describe("resolveAndValidate", () => {
  it("resolves a valid relative path within the base", () => {
    const result = resolveAndValidate("/base/dir", "child/file.txt");
    expect(result).toBe(resolve("/base/dir", "child/file.txt"));
  });

  it("throws for path traversal escaping base directory", () => {
    expect(() => resolveAndValidate("/base/dir", "../../etc/passwd")).toThrow(
      /path must be within the base directory/,
    );
  });

  it("throws when resolved path equals base exactly (no trailing sep)", () => {
    // resolve("/base/dir", ".") === "/base/dir" which doesn't start with "/base/dir/"
    expect(() => resolveAndValidate("/base/dir", ".")).toThrow(
      /path must be within the base directory/,
    );
  });

  it("resolves nested paths correctly", () => {
    const result = resolveAndValidate("/base", "a/b/c/d.txt");
    expect(result).toBe(resolve("/base", "a/b/c/d.txt"));
  });
});
