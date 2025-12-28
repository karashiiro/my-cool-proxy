import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerConfig } from "../../types/interfaces.js";

/**
 * Generates a test configuration file and returns its path.
 * The config file will be created in a temporary directory.
 *
 * @param config - The server configuration to write
 * @returns Object containing the config path and cleanup function
 */
export function generateTestConfig(config: ServerConfig): {
  configPath: string;
  cleanup: () => void;
} {
  // Create a temporary directory
  const tempDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  const configPath = join(tempDir, "config.json");

  // Write config to file
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

  return {
    configPath,
    cleanup: () => {
      try {
        unlinkSync(configPath);
        // Note: We don't remove the directory itself to avoid issues if other files exist
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Helper to generate an HTTP mode test configuration
 */
export function generateHttpTestConfig(overrides: Partial<ServerConfig> = {}) {
  const config: ServerConfig = {
    transport: "http",
    port: 3000,
    host: "localhost",
    mcpClients: {},
    ...overrides,
  };
  return generateTestConfig(config);
}

/**
 * Helper to generate a stdio mode test configuration
 */
export function generateStdioTestConfig(overrides: Partial<ServerConfig> = {}) {
  const config: ServerConfig = {
    transport: "stdio",
    mcpClients: {},
    ...overrides,
  };
  return generateTestConfig(config);
}
