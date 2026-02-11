import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  sandboxPath,
  sandboxPathForRead,
  sandboxPathForWrite,
  PathSandboxError,
} from "./path-sandbox.js";

describe("path-sandbox", () => {
  let sandbox: string;
  let realSandbox: string;
  let outsideDir: string;

  beforeEach(() => {
    // Create a temp sandbox directory
    sandbox = join(tmpdir(), `sandbox-test-${Date.now()}-${Math.random()}`);
    outsideDir = join(tmpdir(), `outside-test-${Date.now()}-${Math.random()}`);
    mkdirSync(sandbox, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    // Get the real path (handles macOS /var -> /private/var symlinks)
    realSandbox = realpathSync(sandbox);
  });

  afterEach(() => {
    // Cleanup
    rmSync(sandbox, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  describe("sandboxPath", () => {
    it("allows paths within sandbox", () => {
      const result = sandboxPath("file.txt", sandbox);
      expect(result).toBe(join(sandbox, "file.txt"));
    });

    it("allows nested paths within sandbox", () => {
      const result = sandboxPath("subdir/nested/file.txt", sandbox);
      expect(result).toBe(join(sandbox, "subdir/nested/file.txt"));
    });

    it("allows the sandbox root itself", () => {
      const result = sandboxPath(".", sandbox);
      expect(result).toBe(sandbox);
    });

    it("allows empty string (resolves to sandbox root)", () => {
      const result = sandboxPath("", sandbox);
      expect(result).toBe(sandbox);
    });

    it("rejects path traversal with ../", () => {
      expect(() => sandboxPath("../etc/passwd", sandbox)).toThrow(
        PathSandboxError,
      );
    });

    it("rejects deeply nested path traversal", () => {
      expect(() => sandboxPath("subdir/../../etc/passwd", sandbox)).toThrow(
        PathSandboxError,
      );
    });

    it("rejects absolute paths outside sandbox", () => {
      expect(() => sandboxPath("/etc/passwd", sandbox)).toThrow(
        PathSandboxError,
      );
    });

    it("allows absolute paths inside sandbox", () => {
      const absoluteInside = join(sandbox, "file.txt");
      const result = sandboxPath(absoluteInside, sandbox);
      expect(result).toBe(absoluteInside);
    });

    it("rejects null bytes (path traversal attack)", () => {
      expect(() => sandboxPath("file.txt\0.jpg", sandbox)).toThrow(
        PathSandboxError,
      );
    });

    it("rejects null bytes in middle of path", () => {
      expect(() => sandboxPath("sub\0dir/file.txt", sandbox)).toThrow(
        PathSandboxError,
      );
    });

    it("normalizes redundant slashes", () => {
      const result = sandboxPath("subdir//file.txt", sandbox);
      expect(result).toBe(join(sandbox, "subdir/file.txt"));
    });

    it("normalizes . components", () => {
      const result = sandboxPath("./subdir/./file.txt", sandbox);
      expect(result).toBe(join(sandbox, "subdir/file.txt"));
    });

    it("rejects sandbox that is not absolute", () => {
      expect(() => sandboxPath("file.txt", "relative/path")).toThrow(
        PathSandboxError,
      );
    });

    it("prevents sandbox escape via prefix collision", () => {
      // /sandbox should not match /sandbox-other
      const otherDir = sandbox + "-other";
      const escapePath = join(otherDir, "file.txt");

      // This should fail because the absolute path is outside sandbox
      expect(() => sandboxPath(escapePath, sandbox)).toThrow(PathSandboxError);
    });
  });

  describe("sandboxPathForRead", () => {
    it("allows reading existing files within sandbox", async () => {
      const filePath = join(sandbox, "test.txt");
      writeFileSync(filePath, "test content");

      const result = await sandboxPathForRead("test.txt", sandbox);
      // Returns the real path (handles macOS /var -> /private/var and Windows short/long paths)
      expect(result).toBe(realpathSync(filePath));
    });

    it("allows reading files in subdirectories", async () => {
      const subdir = join(sandbox, "subdir");
      mkdirSync(subdir);
      const filePath = join(subdir, "test.txt");
      writeFileSync(filePath, "test content");

      const result = await sandboxPathForRead("subdir/test.txt", sandbox);
      // Returns the real path (handles macOS /var -> /private/var and Windows short/long paths)
      expect(result).toBe(realpathSync(filePath));
    });

    it("throws for non-existent files", async () => {
      await expect(
        sandboxPathForRead("nonexistent.txt", sandbox),
      ).rejects.toThrow(PathSandboxError);
    });

    it("rejects symlinks pointing outside sandbox", async () => {
      // Create a file outside the sandbox
      const outsideFile = join(outsideDir, "secret.txt");
      writeFileSync(outsideFile, "secret content");

      // Create a symlink inside sandbox pointing outside
      const symlinkPath = join(sandbox, "evil-link");
      symlinkSync(outsideFile, symlinkPath);

      // The symlink exists inside sandbox, but points outside
      await expect(sandboxPathForRead("evil-link", sandbox)).rejects.toThrow(
        PathSandboxError,
      );
    });

    it("allows symlinks pointing within sandbox", async () => {
      // Create a real file inside sandbox
      const realFile = join(sandbox, "real.txt");
      writeFileSync(realFile, "real content");

      // Create a symlink to it
      const symlinkPath = join(sandbox, "link.txt");
      symlinkSync(realFile, symlinkPath);

      const result = await sandboxPathForRead("link.txt", sandbox);
      // Returns the real path (handles macOS /var -> /private/var and Windows short/long paths)
      expect(result).toBe(realpathSync(realFile));
    });

    it("rejects path traversal before checking existence", async () => {
      await expect(
        sandboxPathForRead("../etc/passwd", sandbox),
      ).rejects.toThrow(PathSandboxError);
    });
  });

  describe("sandboxPathForWrite", () => {
    it("allows writing to files when parent exists", async () => {
      const result = await sandboxPathForWrite("newfile.txt", sandbox);
      expect(result).toBe(join(sandbox, "newfile.txt"));
    });

    it("allows writing to nested paths when parent exists", async () => {
      const subdir = join(sandbox, "subdir");
      mkdirSync(subdir);

      const result = await sandboxPathForWrite("subdir/newfile.txt", sandbox);
      expect(result).toBe(join(subdir, "newfile.txt"));
    });

    it("rejects writing when parent directory does not exist", async () => {
      await expect(
        sandboxPathForWrite("nonexistent/file.txt", sandbox),
      ).rejects.toThrow(PathSandboxError);
    });

    it("rejects writing to sandbox root itself", async () => {
      await expect(sandboxPathForWrite(".", sandbox)).rejects.toThrow(
        PathSandboxError,
      );
    });

    it("rejects writing outside sandbox", async () => {
      await expect(
        sandboxPathForWrite("../outside.txt", sandbox),
      ).rejects.toThrow(PathSandboxError);
    });

    it("rejects null bytes", async () => {
      await expect(sandboxPathForWrite("file\0.txt", sandbox)).rejects.toThrow(
        PathSandboxError,
      );
    });

    it("allows overwriting existing files", async () => {
      const existingFile = join(sandbox, "existing.txt");
      writeFileSync(existingFile, "old content");

      const result = await sandboxPathForWrite("existing.txt", sandbox);
      expect(result).toBe(existingFile);
    });
  });

  describe("PathSandboxError", () => {
    it("is instanceof Error", () => {
      const error = new PathSandboxError("test");
      expect(error).toBeInstanceOf(Error);
    });

    it("is instanceof PathSandboxError", () => {
      const error = new PathSandboxError("test");
      expect(error).toBeInstanceOf(PathSandboxError);
    });

    it("has correct name", () => {
      const error = new PathSandboxError("test message");
      expect(error.name).toBe("PathSandboxError");
    });

    it("preserves message", () => {
      const error = new PathSandboxError("test message");
      expect(error.message).toBe("test message");
    });
  });
});
