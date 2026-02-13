import envPaths from "env-paths";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const APP_NAME = "my-cool-proxy";

/**
 * Characters that are invalid in filenames on Windows.
 * Also includes characters that could cause issues on other platforms.
 * Control characters (0x00-0x1F) are also filtered.
 */
// eslint-disable-next-line no-control-regex
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

/**
 * Sanitize a filename for cross-platform safety.
 * Replaces invalid characters with underscores and trims whitespace.
 *
 * @param filename - The filename to sanitize
 * @returns A safe filename string
 */
export function sanitizeFilename(filename: string): string {
  return filename.replace(INVALID_FILENAME_CHARS, "_").trim();
}

/**
 * Dependencies for the log paths service.
 * Allows injection of filesystem operations and base path for testing.
 */
export interface LogPathsDeps {
  /** Base log directory path */
  basePath: string;
  /** Filesystem operations */
  fs: {
    existsSync: (path: string) => boolean;
    mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  };
}

/**
 * Log paths service interface.
 */
export interface LogPathsService {
  /**
   * Get the platform-specific log directory.
   */
  getLogDir(): string;

  /**
   * Get the directory for server stderr log files.
   */
  getServerLogDir(): string;

  /**
   * Ensure the server log directory exists.
   * Creates the directory (and any parent directories) if it doesn't exist.
   */
  ensureServerLogDir(): string;

  /**
   * Get the log file path for a specific MCP server.
   *
   * @param serverName - The name of the server
   * @param sessionId - Optional session ID (used in HTTP mode for multi-session)
   */
  getServerLogPath(serverName: string, sessionId?: string): string;
}

/**
 * Create a log paths service with the given dependencies.
 * This factory pattern allows for easy testing by injecting mock dependencies.
 *
 * @param deps - Dependencies including base path and filesystem operations
 * @returns A log paths service instance
 *
 * @example
 * // Production usage (uses default export instead)
 * import { getLogDir, ensureServerLogDir } from './log-paths.js';
 *
 * @example
 * // Testing with mocks
 * const mockFs = { existsSync: vi.fn(), mkdirSync: vi.fn() };
 * const logPaths = createLogPaths({ basePath: '/tmp/test', fs: mockFs });
 */
export function createLogPaths(deps: LogPathsDeps): LogPathsService {
  const { basePath, fs } = deps;

  const getLogDir = (): string => {
    return basePath;
  };

  const getServerLogDir = (): string => {
    return resolve(basePath, "servers");
  };

  const ensureServerLogDir = (): string => {
    const dir = getServerLogDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  };

  const getServerLogPath = (serverName: string, sessionId?: string): string => {
    const safeName = sanitizeFilename(serverName);
    const filename = sessionId
      ? `${safeName}-${sanitizeFilename(sessionId)}.log`
      : `${safeName}.log`;
    return resolve(getServerLogDir(), filename);
  };

  return {
    getLogDir,
    getServerLogDir,
    ensureServerLogDir,
    getServerLogPath,
  };
}

// Create default instance with real dependencies for production use
const defaultPaths = envPaths(APP_NAME, { suffix: "" });
const defaultLogPaths = createLogPaths({
  basePath: defaultPaths.log,
  fs: { existsSync, mkdirSync },
});

/**
 * Get the platform-specific log directory.
 *
 * Platform paths:
 * - Windows: %LOCALAPPDATA%\my-cool-proxy\Log\
 * - macOS: ~/Library/Logs/my-cool-proxy/
 * - Linux: ~/.local/state/my-cool-proxy/ (respects $XDG_STATE_HOME)
 */
export const getLogDir = defaultLogPaths.getLogDir;

/**
 * Get the directory for server stderr log files.
 *
 * Platform paths:
 * - Windows: %LOCALAPPDATA%\my-cool-proxy\Log\servers\
 * - macOS: ~/Library/Logs/my-cool-proxy/servers/
 * - Linux: ~/.local/state/my-cool-proxy/servers/
 */
export const getServerLogDir = defaultLogPaths.getServerLogDir;

/**
 * Ensure the server log directory exists.
 * Creates the directory (and any parent directories) if it doesn't exist.
 *
 * @returns The path to the server log directory
 */
export const ensureServerLogDir = defaultLogPaths.ensureServerLogDir;

/**
 * Get the log file path for a specific MCP server.
 *
 * @param serverName - The name of the server
 * @param sessionId - Optional session ID (used in HTTP mode for multi-session)
 * @returns The full path to the server's log file
 *
 * @example
 * // Stdio mode (single session)
 * getServerLogPath("calculator") // => ".../servers/calculator.log"
 *
 * // HTTP mode (multi-session)
 * getServerLogPath("calculator", "abc123") // => ".../servers/calculator-abc123.log"
 */
export const getServerLogPath = defaultLogPaths.getServerLogPath;

/**
 * Get the log file path for the gateway application itself.
 *
 * Platform paths:
 * - Windows: %LOCALAPPDATA%\my-cool-proxy\Log\gateway.log
 * - macOS: ~/Library/Logs/my-cool-proxy/gateway.log
 * - Linux: ~/.local/state/my-cool-proxy/gateway.log
 *
 * @returns The full path to the gateway log file
 */
export function getGatewayLogPath(): string {
  return resolve(getLogDir(), "gateway.log");
}
