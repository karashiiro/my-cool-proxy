import { readFileSync } from "fs";
import { resolve } from "path";
import type { ServerConfig } from "../types/interfaces.js";

/**
 * Loads server configuration from a JSON file.
 * The config file path can be specified via the CONFIG_PATH environment variable.
 * Defaults to 'config.json' in the current working directory.
 *
 * @returns The loaded server configuration
 * @throws Error if the config file cannot be read or parsed
 */
export function loadConfig(): ServerConfig {
  const configPath =
    process.env.CONFIG_PATH || resolve(process.cwd(), "config.json");

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
    }

    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Configuration file not found at: ${configPath}\n` +
          `You can create a config.json file or set the CONFIG_PATH environment variable.`,
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
