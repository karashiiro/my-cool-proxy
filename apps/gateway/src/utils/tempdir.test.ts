import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSessionTempDir, cleanupSessionTempDir } from "./tempdir.js";

describe("tempdir utilities", () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    // Clean up any directories created during tests
    for (const dir of createdDirs) {
      try {
        cleanupSessionTempDir(dir);
      } catch {
        // Best-effort cleanup
      }
    }
    createdDirs.length = 0;
  });

  describe("createSessionTempDir", () => {
    it("should create a temporary directory with session ID in the name", () => {
      const sessionId = "test-session-123";
      const dir = createSessionTempDir(sessionId);
      createdDirs.push(dir);

      expect(dir).toContain("mcp-gateway-test-session-123-");
      expect(existsSync(dir)).toBe(true);
    });

    it("should create directory in OS temp directory", () => {
      const sessionId = "test-session-456";
      const dir = createSessionTempDir(sessionId);
      createdDirs.push(dir);

      expect(dir.startsWith(tmpdir())).toBe(true);
    });

    it("should create unique directories for the same session ID", () => {
      const sessionId = "same-session";
      const dir1 = createSessionTempDir(sessionId);
      const dir2 = createSessionTempDir(sessionId);
      createdDirs.push(dir1, dir2);

      expect(dir1).not.toBe(dir2);
      expect(existsSync(dir1)).toBe(true);
      expect(existsSync(dir2)).toBe(true);
    });

    it("should create an empty directory", () => {
      const sessionId = "empty-test";
      const dir = createSessionTempDir(sessionId);
      createdDirs.push(dir);

      const contents = readdirSync(dir);
      expect(contents).toHaveLength(0);
    });
  });

  describe("cleanupSessionTempDir", () => {
    it("should remove an empty directory", () => {
      const sessionId = "cleanup-test-1";
      const dir = createSessionTempDir(sessionId);

      cleanupSessionTempDir(dir);

      expect(existsSync(dir)).toBe(false);
    });

    it("should remove directory with files", () => {
      const sessionId = "cleanup-test-2";
      const dir = createSessionTempDir(sessionId);

      // Create some files in the directory
      writeFileSync(join(dir, "test.txt"), "test content");
      writeFileSync(join(dir, "test2.txt"), "more content");

      cleanupSessionTempDir(dir);

      expect(existsSync(dir)).toBe(false);
    });

    it("should remove directory with subdirectories", () => {
      const sessionId = "cleanup-test-3";
      const dir = createSessionTempDir(sessionId);

      // Create nested structure
      const subdir = join(dir, "subdir");
      mkdirSync(subdir);
      writeFileSync(join(subdir, "nested.txt"), "nested content");

      cleanupSessionTempDir(dir);

      expect(existsSync(dir)).toBe(false);
    });

    it("should not throw when directory does not exist", () => {
      const nonExistentDir = join(tmpdir(), "non-existent-dir-12345");

      expect(() => cleanupSessionTempDir(nonExistentDir)).not.toThrow();
    });

    it("should not throw when given invalid path", () => {
      const invalidPath = "/invalid/path/that/does/not/exist";

      expect(() => cleanupSessionTempDir(invalidPath)).not.toThrow();
    });
  });
});
