import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { ServerConfig } from "../types/interfaces.js";
import { getActiveConfigPath, getPlatformConfigPath } from "./config-paths.js";

/**
 * Default configuration for first-time setup.
 * Uses HTTP transport with standard port/host.
 */
export const DEFAULT_CONFIG: ServerConfig = {
  port: 3000,
  host: "localhost",
  transport: "http",
  mcpClients: {},
};

/**
 * Creates a default config file at the platform-specific location.
 * Creates the parent directory if it doesn't exist.
 *
 * @returns The path where the config was created
 */
export function createDefaultConfig(): string {
  const configPath = getPlatformConfigPath();
  const configDir = dirname(configPath);

  // Create directory recursively (handles nested paths)
  mkdirSync(configDir, { recursive: true });

  // Write pretty-printed JSON for readability
  writeFileSync(
    configPath,
    JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
    "utf-8",
  );

  return configPath;
}

/**
 * Loads server configuration from a JSON file.
 *
 * Search order:
 * 1. CONFIG_PATH environment variable (explicit override)
 * 2. Platform-specific user directory:
 *    - Windows: %APPDATA%\my-cool-proxy\config.json
 *    - macOS: ~/Library/Application Support/my-cool-proxy/config.json
 *    - Linux: ~/.config/my-cool-proxy/config.json (respects $XDG_CONFIG_HOME)
 *
 * @returns The loaded server configuration
 * @throws Error if the config file cannot be read or parsed
 */
export function loadConfig(): ServerConfig {
  const activePath = getActiveConfigPath();

  if (!activePath) {
    // No config found - create a default one at the platform location
    const createdPath = createDefaultConfig();

    // Log to stderr (stdout may be used for MCP protocol in stdio mode)
    console.error(`\n  Created default config at: ${createdPath}`);
    console.error(`  Edit this file to add your MCP servers.`);
    console.error(`  See docs/configuration.md for configuration options.\n`);

    // Return the default config directly (we know what we wrote)
    return { ...DEFAULT_CONFIG };
  }

  const configPath = activePath.path;

  try {
    const configContent = readFileSync(configPath, "utf-8");
    const config = JSON.parse(configContent) as ServerConfig;

    // Validate mcpClients (always required)
    if (
      typeof config.mcpClients !== "object" ||
      config.mcpClients === null ||
      Array.isArray(config.mcpClients)
    ) {
      throw new Error("Config must specify 'mcpClients' as an object");
    }

    // Validate transport if provided
    if (config.transport !== undefined) {
      if (config.transport !== "http" && config.transport !== "stdio") {
        throw new Error(
          "Config 'transport' must be 'http' or 'stdio' if specified",
        );
      }
    }

    // Set default transport to http
    if (!config.transport) {
      config.transport = "http";
    }

    // Validate port and host only if using HTTP transport
    if (config.transport === "http") {
      if (typeof config.port !== "number") {
        throw new Error(
          "Config must specify 'port' as a number when using HTTP transport",
        );
      }
      if (typeof config.host !== "string") {
        throw new Error(
          "Config must specify 'host' as a string when using HTTP transport",
        );
      }
    }

    // Validate skills config if provided
    if (config.skills !== undefined) {
      if (typeof config.skills !== "object" || config.skills === null) {
        throw new Error("Config 'skills' must be an object if specified");
      }

      if (
        config.skills.enabled !== undefined &&
        typeof config.skills.enabled !== "boolean"
      ) {
        throw new Error(
          "Config 'skills.enabled' must be a boolean if specified",
        );
      }

      if (
        config.skills.mutable !== undefined &&
        typeof config.skills.mutable !== "boolean"
      ) {
        throw new Error(
          "Config 'skills.mutable' must be a boolean if specified",
        );
      }
    }

    // Validate acp config if provided
    if (config.acp !== undefined) {
      if (typeof config.acp !== "object" || config.acp === null) {
        throw new Error("Config 'acp' must be an object if specified");
      }

      if (config.acp.agent !== undefined) {
        if (typeof config.acp.agent !== "object" || config.acp.agent === null) {
          throw new Error("Config 'acp.agent' must be an object if specified");
        }

        if (typeof config.acp.agent.command !== "string") {
          throw new Error(
            "Config 'acp.agent' must specify 'command' as a string",
          );
        }

        if (
          config.acp.agent.args !== undefined &&
          !Array.isArray(config.acp.agent.args)
        ) {
          throw new Error(
            "Config 'acp.agent.args' must be an array if specified",
          );
        }

        if (config.acp.agent.args !== undefined) {
          for (const arg of config.acp.agent.args) {
            if (typeof arg !== "string") {
              throw new Error(
                "Config 'acp.agent.args' must contain only strings",
              );
            }
          }
        }

        if (config.acp.agent.env !== undefined) {
          if (
            typeof config.acp.agent.env !== "object" ||
            config.acp.agent.env === null
          ) {
            throw new Error(
              "Config 'acp.agent.env' must be an object if specified",
            );
          }

          for (const [key, value] of Object.entries(config.acp.agent.env)) {
            if (typeof value !== "string") {
              throw new Error(`Config 'acp.agent.env.${key}' must be a string`);
            }
          }
        }
      }
    }

    // Validate logging config if provided
    const VALID_LOG_LEVELS = [
      "trace",
      "debug",
      "info",
      "warn",
      "error",
      "fatal",
    ];

    if (config.logging !== undefined) {
      if (typeof config.logging !== "object" || config.logging === null) {
        throw new Error("Config 'logging' must be an object if specified");
      }

      if (config.logging.console !== undefined) {
        if (
          typeof config.logging.console !== "object" ||
          config.logging.console === null
        ) {
          throw new Error(
            "Config 'logging.console' must be an object if specified",
          );
        }
        if (config.logging.console.level !== undefined) {
          if (!VALID_LOG_LEVELS.includes(config.logging.console.level)) {
            throw new Error(
              `Config 'logging.console.level' must be one of: ${VALID_LOG_LEVELS.join(", ")}`,
            );
          }
        }
      }

      if (config.logging.file !== undefined) {
        if (
          typeof config.logging.file !== "object" ||
          config.logging.file === null
        ) {
          throw new Error(
            "Config 'logging.file' must be an object if specified",
          );
        }
        if (config.logging.file.level !== undefined) {
          if (!VALID_LOG_LEVELS.includes(config.logging.file.level)) {
            throw new Error(
              `Config 'logging.file.level' must be one of: ${VALID_LOG_LEVELS.join(", ")}`,
            );
          }
        }
      }
    }

    // Validate each MCP client config
    for (const [name, clientConfig] of Object.entries(config.mcpClients)) {
      if (typeof clientConfig !== "object" || clientConfig === null) {
        throw new Error(
          `MCP client '${name}' must be an object with type and transport details`,
        );
      }

      if (clientConfig.type === "http") {
        if (typeof clientConfig.url !== "string") {
          throw new Error(
            `MCP client '${name}' with type 'http' must specify 'url' as a string`,
          );
        }
      } else if (clientConfig.type === "stdio") {
        if (typeof clientConfig.command !== "string") {
          throw new Error(
            `MCP client '${name}' with type 'stdio' must specify 'command' as a string`,
          );
        }
      } else {
        throw new Error(
          `MCP client '${name}' has invalid type. Must be 'http' or 'stdio'`,
        );
      }

      // Validate allowedTools if provided
      if (clientConfig.allowedTools !== undefined) {
        if (!Array.isArray(clientConfig.allowedTools)) {
          throw new Error(
            `MCP client '${name}' has invalid 'allowedTools'. Must be an array of strings`,
          );
        }

        for (const tool of clientConfig.allowedTools) {
          if (typeof tool !== "string") {
            throw new Error(
              `MCP client '${name}' has invalid tool in 'allowedTools'. All items must be strings`,
            );
          }
        }
      }

      // Validate dangerouslyEnableSampling if provided
      if (clientConfig.dangerouslyEnableSampling !== undefined) {
        if (typeof clientConfig.dangerouslyEnableSampling !== "boolean") {
          throw new Error(
            `MCP client '${name}' has invalid 'dangerouslyEnableSampling'. Must be a boolean (true or false)`,
          );
        }
      }
    }

    return config;
  } catch (error) {
    // Re-throw with more context for parse errors
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON in config file at ${configPath}: ${error.message}`,
      );
    }
    throw error;
  }
}

/**
 * Merges environment variables into the config.
 * Environment variables take precedence over config file values.
 *
 * @param config - The base configuration to merge into
 * @returns The merged configuration
 */
export function mergeEnvConfig(config: ServerConfig): ServerConfig {
  return {
    ...config,
    port: process.env.PORT ? parseInt(process.env.PORT) : config.port,
    host: process.env.HOST || config.host,
  };
}
