import envPaths from "env-paths";
import { existsSync } from "fs";
import { resolve } from "path";

const APP_NAME = "my-cool-proxy";
const CONFIG_FILENAME = "config.json";

// Get platform-specific paths (disable nodejs suffix for cleaner paths)
const paths = envPaths(APP_NAME, { suffix: "" });

export interface ConfigPathInfo {
  path: string;
  source: "env" | "platform";
  exists: boolean;
}

/**
 * Get all potential config paths in priority order.
 *
 * Search order:
 * 1. CONFIG_PATH environment variable (explicit override)
 * 2. Platform-specific user directory:
 *    - Windows: %APPDATA%\my-cool-proxy\config.json
 *    - macOS: ~/Library/Application Support/my-cool-proxy/config.json
 *    - Linux: ~/.config/my-cool-proxy/config.json (respects $XDG_CONFIG_HOME)
 */
export function getConfigPaths(): ConfigPathInfo[] {
  const result: ConfigPathInfo[] = [];

  // 1. Environment variable override (highest priority)
  if (process.env.CONFIG_PATH) {
    result.push({
      path: process.env.CONFIG_PATH,
      source: "env",
      exists: existsSync(process.env.CONFIG_PATH),
    });
  }

  // 2. Platform-specific user directory
  const platformPath = resolve(paths.config, CONFIG_FILENAME);
  result.push({
    path: platformPath,
    source: "platform",
    exists: existsSync(platformPath),
  });

  return result;
}

/**
 * Get the config path that will actually be used (first existing path).
 * Returns null if no config file exists at any searched location.
 */
export function getActiveConfigPath(): ConfigPathInfo | null {
  const configPaths = getConfigPaths();
  return configPaths.find((p) => p.exists) || null;
}

/**
 * Get the platform-specific config directory.
 */
export function getPlatformConfigDir(): string {
  return paths.config;
}

/**
 * Get the platform-specific config file path.
 */
export function getPlatformConfigPath(): string {
  return resolve(paths.config, CONFIG_FILENAME);
}
