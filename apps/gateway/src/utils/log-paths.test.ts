import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { resolve } from "path";
import {
  createLogPaths,
  sanitizeFilename,
  type LogPathsDeps,
  // Also test the default exports work
  getLogDir,
  getServerLogDir,
  getServerLogPath,
  ensureServerLogDir,
  getGatewayLogPath,
} from "./log-paths.js";

/**
 * Type for our mock filesystem object.
 * Uses Mock types for the functions so we can call mockReturnValue etc.
 */
interface MockFs {
  existsSync: Mock<(path: string) => boolean>;
  mkdirSync: Mock<(path: string, options?: { recursive?: boolean }) => void>;
}

describe("log-paths", () => {
  describe("sanitizeFilename (pure function)", () => {
    it("should replace Windows-invalid characters with underscores", () => {
      const result = sanitizeFilename('file<>:"/\\|?*name');

      expect(result).toBe("file_________name");
      expect(result).not.toMatch(/[<>:"/\\|?*]/);
    });

    it("should trim whitespace", () => {
      const result = sanitizeFilename("  filename  ");

      expect(result).toBe("filename");
    });

    it("should handle empty string", () => {
      const result = sanitizeFilename("");

      expect(result).toBe("");
    });

    it("should preserve normal characters", () => {
      const result = sanitizeFilename("my-cool-server_v2.0");

      expect(result).toBe("my-cool-server_v2.0");
    });

    it("should handle control characters", () => {
      const result = sanitizeFilename("file\x00\x1fname");

      expect(result).toBe("file__name");
    });
  });

  describe("createLogPaths (factory)", () => {
    const TEST_BASE_PATH = "/test/logs";
    let mockFs: MockFs;

    beforeEach(() => {
      mockFs = {
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
      };
    });

    // Helper to create log paths with our mock fs
    function createTestLogPaths(basePath: string = TEST_BASE_PATH) {
      return createLogPaths({
        basePath,
        fs: mockFs as unknown as LogPathsDeps["fs"],
      });
    }

    describe("getLogDir", () => {
      it("should return the base path", () => {
        const logPaths = createTestLogPaths();

        expect(logPaths.getLogDir()).toBe(TEST_BASE_PATH);
      });

      it("should return different paths for different base paths", () => {
        const logPaths1 = createTestLogPaths("/path/one");
        const logPaths2 = createTestLogPaths("/path/two");

        expect(logPaths1.getLogDir()).toBe("/path/one");
        expect(logPaths2.getLogDir()).toBe("/path/two");
      });
    });

    describe("getServerLogDir", () => {
      it("should return base path with servers subdirectory", () => {
        const logPaths = createTestLogPaths();

        expect(logPaths.getServerLogDir()).toBe(
          resolve(TEST_BASE_PATH, "servers"),
        );
      });
    });

    describe("getServerLogPath", () => {
      it("should generate log path for server name only", () => {
        const logPaths = createTestLogPaths();

        const path = logPaths.getServerLogPath("calculator");

        expect(path).toBe(resolve(TEST_BASE_PATH, "servers", "calculator.log"));
      });

      it("should generate log path with session ID", () => {
        const logPaths = createTestLogPaths();

        const path = logPaths.getServerLogPath("calculator", "session123");

        expect(path).toBe(
          resolve(TEST_BASE_PATH, "servers", "calculator-session123.log"),
        );
      });

      it("should sanitize server names with special characters", () => {
        const logPaths = createTestLogPaths();

        const path = logPaths.getServerLogPath("my:server/name");

        expect(path).toBe(
          resolve(TEST_BASE_PATH, "servers", "my_server_name.log"),
        );
      });

      it("should sanitize session IDs with special characters", () => {
        const logPaths = createTestLogPaths();

        const path = logPaths.getServerLogPath("server", "session:123/abc");

        expect(path).toBe(
          resolve(TEST_BASE_PATH, "servers", "server-session_123_abc.log"),
        );
      });
    });

    describe("ensureServerLogDir", () => {
      it("should create directory if it does not exist", () => {
        mockFs.existsSync.mockReturnValue(false);
        const logPaths = createTestLogPaths();

        logPaths.ensureServerLogDir();

        expect(mockFs.existsSync).toHaveBeenCalledWith(
          resolve(TEST_BASE_PATH, "servers"),
        );
        expect(mockFs.mkdirSync).toHaveBeenCalledWith(
          resolve(TEST_BASE_PATH, "servers"),
          { recursive: true },
        );
      });

      it("should not create directory if it already exists", () => {
        mockFs.existsSync.mockReturnValue(true);
        const logPaths = createTestLogPaths();

        logPaths.ensureServerLogDir();

        expect(mockFs.existsSync).toHaveBeenCalled();
        expect(mockFs.mkdirSync).not.toHaveBeenCalled();
      });

      it("should return the server log directory path", () => {
        mockFs.existsSync.mockReturnValue(true);
        const logPaths = createTestLogPaths();

        const result = logPaths.ensureServerLogDir();

        expect(result).toBe(resolve(TEST_BASE_PATH, "servers"));
      });

      it("should handle mkdirSync being called with recursive option", () => {
        mockFs.existsSync.mockReturnValue(false);
        const logPaths = createTestLogPaths("/deep/nested/path");

        logPaths.ensureServerLogDir();

        expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), {
          recursive: true,
        });
      });
    });
  });

  describe("default exports (integration)", () => {
    // These tests verify the default exports work with real env-paths
    // They test integration with the actual platform paths

    it("getLogDir should return a path containing app name", () => {
      const dir = getLogDir();

      expect(dir).toContain("my-cool-proxy");
      expect(typeof dir).toBe("string");
      expect(dir.length).toBeGreaterThan(0);
    });

    it("getLogDir should not contain nodejs suffix", () => {
      const dir = getLogDir();

      expect(dir).not.toContain("nodejs");
    });

    it("getServerLogDir should be inside log directory", () => {
      const logDir = getLogDir();
      const serverDir = getServerLogDir();

      expect(serverDir.startsWith(logDir)).toBe(true);
      expect(serverDir).toMatch(/servers[/\\]?$/);
    });

    it("getServerLogPath should generate valid paths", () => {
      const path = getServerLogPath("test-server");

      expect(path).toContain("servers");
      expect(path).toContain("test-server.log");
    });

    it("getServerLogPath with sessionId should include both", () => {
      const path = getServerLogPath("test-server", "abc123");

      expect(path).toContain("servers");
      expect(path).toContain("test-server-abc123.log");
    });

    it("ensureServerLogDir should return server log directory", () => {
      // This actually creates the directory, but that's ok for integration tests
      const result = ensureServerLogDir();

      expect(result).toContain("servers");
      expect(result).toContain("my-cool-proxy");
    });

    it("getGatewayLogPath should return path inside log directory", () => {
      const logDir = getLogDir();
      const gatewayPath = getGatewayLogPath();

      expect(gatewayPath.startsWith(logDir)).toBe(true);
      expect(gatewayPath).toMatch(/gateway\.log$/);
    });

    it("getGatewayLogPath should not include servers subdirectory", () => {
      const gatewayPath = getGatewayLogPath();

      expect(gatewayPath).not.toContain("servers");
    });

    it("getGatewayLogPath should contain app name", () => {
      const gatewayPath = getGatewayLogPath();

      expect(gatewayPath).toContain("my-cool-proxy");
    });
  });
});
