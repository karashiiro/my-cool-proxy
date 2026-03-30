import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import type { Root } from "@modelcontextprotocol/sdk/types.js";
import { extractLocalPath, findValidLocalRoot } from "./root-utils.js";

describe("root-utils", () => {
  let testDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    testDir = join(tmpdir(), `root-utils-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  describe("extractLocalPath", () => {
    it("should extract path from valid file:// URI", () => {
      const uri = `file://${testDir}`;
      const result = extractLocalPath(uri);

      expect(result).toBe(testDir);
    });

    it("should return undefined for non-file:// protocol", () => {
      const httpUri = "https://example.com/path";
      const result = extractLocalPath(httpUri);

      expect(result).toBeUndefined();
    });

    it("should return undefined for file:// URI with remote hostname", () => {
      const remoteUri = "file://remote-host/path/to/file";
      const result = extractLocalPath(remoteUri);

      expect(result).toBeUndefined();
    });

    it("should accept file:// URI with localhost hostname", () => {
      // Convert path to URI format (handle Windows paths)
      const fileUrl = pathToFileURL(testDir).toString();
      // Replace file:/// with file://localhost/ to test localhost handling
      const uri = fileUrl.replace("file:///", "file://localhost/");

      const result = extractLocalPath(uri);

      expect(result).toBe(testDir);
    });

    it("should accept file:// URI with empty hostname", () => {
      const uri = `file://${testDir}`;
      const result = extractLocalPath(uri);

      expect(result).toBe(testDir);
    });

    it("should return undefined for non-existent path", () => {
      const nonExistentPath = join(tmpdir(), "non-existent-dir-12345");
      const uri = `file://${nonExistentPath}`;
      const result = extractLocalPath(uri);

      expect(result).toBeUndefined();
    });

    it("should return undefined for invalid URI", () => {
      const invalidUri = "not-a-valid-uri";
      const result = extractLocalPath(invalidUri);

      expect(result).toBeUndefined();
    });

    it("should return undefined for http:// URI", () => {
      const httpUri = "http://example.com/path";
      const result = extractLocalPath(httpUri);

      expect(result).toBeUndefined();
    });

    it("should return undefined for https:// URI", () => {
      const httpsUri = "https://example.com/path";
      const result = extractLocalPath(httpsUri);

      expect(result).toBeUndefined();
    });

    it("should handle Windows-style paths in file:// URI", () => {
      if (process.platform === "win32") {
        const windowsPath = testDir.replace(/\\/g, "/");
        const uri = `file:///${windowsPath}`;
        const result = extractLocalPath(uri);

        expect(result).toBeTruthy();
      }
    });
  });

  describe("findValidLocalRoot", () => {
    it("should return first valid local root", () => {
      const roots: Root[] = [
        { uri: "https://example.com/remote", name: "Remote" },
        { uri: `file://${testDir}`, name: "Local" },
        { uri: "file:///non-existent", name: "Invalid" },
      ];

      const result = findValidLocalRoot(roots);

      expect(result).toBe(testDir);
    });

    it("should return undefined when no valid roots exist", () => {
      const roots: Root[] = [
        { uri: "https://example.com/remote", name: "Remote" },
        { uri: "file:///non-existent", name: "Invalid" },
      ];

      const result = findValidLocalRoot(roots);

      expect(result).toBeUndefined();
    });

    it("should return undefined for empty roots array", () => {
      const roots: Root[] = [];

      const result = findValidLocalRoot(roots);

      expect(result).toBeUndefined();
    });

    it("should skip remote file URIs with hostnames", () => {
      const roots: Root[] = [
        { uri: "file://remote-host/path", name: "Remote File" },
        { uri: `file://${testDir}`, name: "Local" },
      ];

      const result = findValidLocalRoot(roots);

      expect(result).toBe(testDir);
    });

    it("should handle multiple valid roots and return first", () => {
      const subdir = join(testDir, "subdir");
      mkdirSync(subdir, { recursive: true });

      const roots: Root[] = [
        { uri: `file://${testDir}`, name: "First" },
        { uri: `file://${subdir}`, name: "Second" },
      ];

      const result = findValidLocalRoot(roots);

      expect(result).toBe(testDir);
    });

    it("should skip roots with invalid URIs", () => {
      const roots: Root[] = [
        { uri: "not-a-uri", name: "Invalid" },
        { uri: `file://${testDir}`, name: "Valid" },
      ];

      const result = findValidLocalRoot(roots);

      expect(result).toBe(testDir);
    });

    it("should handle roots with localhost hostname", () => {
      // Convert path to URI format (handle Windows paths)
      const fileUrl = pathToFileURL(testDir).toString();
      // Replace file:/// with file://localhost/ to test localhost handling
      const uri = fileUrl.replace("file:///", "file://localhost/");

      const roots: Root[] = [{ uri, name: "Localhost" }];

      const result = findValidLocalRoot(roots);

      expect(result).toBe(testDir);
    });

    it("should skip non-existent paths even with valid file:// URIs", () => {
      const nonExistent = join(tmpdir(), "definitely-does-not-exist-12345");

      const roots: Root[] = [
        { uri: `file://${nonExistent}`, name: "NonExistent" },
        { uri: `file://${testDir}`, name: "Valid" },
      ];

      const result = findValidLocalRoot(roots);

      expect(result).toBe(testDir);
    });
  });
});
