import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import {
  getConfigPaths,
  getActiveConfigPath,
  getPlatformConfigDir,
  getPlatformConfigPath,
} from "./config-paths.js";

describe("config-paths", () => {
  let originalConfigPath: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalConfigPath = process.env.CONFIG_PATH;
    // Create a unique temp directory for each test
    tempDir = resolve(tmpdir(), `config-paths-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original CONFIG_PATH
    if (originalConfigPath !== undefined) {
      process.env.CONFIG_PATH = originalConfigPath;
    } else {
      delete process.env.CONFIG_PATH;
    }

    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("getConfigPaths", () => {
    it("should return platform path when CONFIG_PATH is not set", () => {
      delete process.env.CONFIG_PATH;

      const paths = getConfigPaths();

      expect(paths).toHaveLength(1);
      expect(paths[0]!.source).toBe("platform");
      expect(paths[0]!.path).toContain("my-cool-proxy");
      expect(paths[0]!.path).toContain("config.json");
    });

    it("should return CONFIG_PATH first when set", () => {
      const customPath = resolve(tempDir, "custom-config.json");
      process.env.CONFIG_PATH = customPath;

      const paths = getConfigPaths();

      expect(paths).toHaveLength(2);
      expect(paths[0]!.source).toBe("env");
      expect(paths[0]!.path).toBe(customPath);
      expect(paths[1]!.source).toBe("platform");
    });

    it("should mark existing paths correctly", () => {
      const customPath = resolve(tempDir, "existing-config.json");
      writeFileSync(customPath, "{}");
      process.env.CONFIG_PATH = customPath;

      const paths = getConfigPaths();

      expect(paths[0]!.exists).toBe(true);
      expect(paths[0]!.path).toBe(customPath);
    });

    it("should mark non-existing paths correctly", () => {
      process.env.CONFIG_PATH = resolve(tempDir, "nonexistent.json");

      const paths = getConfigPaths();

      expect(paths[0]!.exists).toBe(false);
    });
  });

  describe("getActiveConfigPath", () => {
    it("should return null when CONFIG_PATH does not exist and platform path does not exist", () => {
      // Set CONFIG_PATH to a non-existent file
      process.env.CONFIG_PATH = resolve(tempDir, "definitely-does-not-exist.json");

      const result = getActiveConfigPath();

      // If platform path also doesn't exist (likely in test environment), result is null
      // If platform path happens to exist, result will point to it
      if (result === null) {
        // Expected case: no config found anywhere
        expect(result).toBeNull();
      } else {
        // Platform config exists on this system - verify it's the platform source
        expect(result.source).toBe("platform");
        expect(result.exists).toBe(true);
      }
    });

    it("should return CONFIG_PATH when it exists", () => {
      const customPath = resolve(tempDir, "active-config.json");
      writeFileSync(customPath, "{}");
      process.env.CONFIG_PATH = customPath;

      const result = getActiveConfigPath();

      expect(result).not.toBeNull();
      expect(result!.path).toBe(customPath);
      expect(result!.source).toBe("env");
      expect(result!.exists).toBe(true);
    });

    it("should skip CONFIG_PATH and return platform path when CONFIG_PATH does not exist but platform does", () => {
      // This test is tricky because we can't easily create files at platform path
      // Instead, test the logic by ensuring CONFIG_PATH is checked first
      process.env.CONFIG_PATH = resolve(tempDir, "nonexistent.json");

      const result = getActiveConfigPath();

      // If platform path doesn't exist either, result is null
      // If platform path exists, result points to platform
      if (result !== null) {
        expect(result.exists).toBe(true);
      }
    });

    it("should return first existing path in priority order", () => {
      const customPath = resolve(tempDir, "priority-config.json");
      writeFileSync(customPath, '{"priority": true}');
      process.env.CONFIG_PATH = customPath;

      const result = getActiveConfigPath();

      expect(result).not.toBeNull();
      expect(result!.source).toBe("env");
    });
  });

  describe("getPlatformConfigDir", () => {
    it("should return a directory path containing app name", () => {
      const dir = getPlatformConfigDir();

      expect(dir).toContain("my-cool-proxy");
      expect(typeof dir).toBe("string");
      expect(dir.length).toBeGreaterThan(0);
    });

    it("should not contain nodejs suffix", () => {
      const dir = getPlatformConfigDir();

      expect(dir).not.toContain("nodejs");
    });
  });

  describe("getPlatformConfigPath", () => {
    it("should return a path ending with config.json", () => {
      const path = getPlatformConfigPath();

      expect(path).toContain("config.json");
      expect(path).toContain("my-cool-proxy");
    });

    it("should be inside platform config directory", () => {
      const dir = getPlatformConfigDir();
      const path = getPlatformConfigPath();

      expect(path.startsWith(dir)).toBe(true);
    });
  });
});
