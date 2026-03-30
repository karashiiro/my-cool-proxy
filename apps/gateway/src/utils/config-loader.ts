import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ServerConfig, MCPClientConfig } from "../types/interfaces.js";
import { getActiveConfigPath, getPlatformConfigPath } from "./config-paths.js";

/**
 * Valid log levels for console and file logging.
 */
const VALID_LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];

/**
 * Valid tool kinds for ACP allowOwnTools configuration.
 */
const VALID_TOOL_KINDS = [
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
];

/**
 * Validates the transport configuration.
 * Sets default transport to 'http' if not specified.
 * Validates port and host for HTTP transport.
 */
function validateTransportConfig(config: ServerConfig): void {
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
}

/**
 * Validates the skills configuration if provided.
 */
function validateSkillsConfig(config: ServerConfig): void {
  if (config.skills === undefined) return;

  if (typeof config.skills !== "object" || config.skills === null) {
    throw new Error("Config 'skills' must be an object if specified");
  }

  if (
    config.skills.enabled !== undefined &&
    typeof config.skills.enabled !== "boolean"
  ) {
    throw new Error("Config 'skills.enabled' must be a boolean if specified");
  }

  if (
    config.skills.mutable !== undefined &&
    typeof config.skills.mutable !== "boolean"
  ) {
    throw new Error("Config 'skills.mutable' must be a boolean if specified");
  }
}

/**
 * Validates ACP agent configuration if provided.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
function validateACPAgentConfig(
  agent: NonNullable<ServerConfig["acp"]>["agent"],
): void {
  if (agent === undefined) return;

  if (typeof agent !== "object" || agent === null) {
    throw new Error("Config 'acp.agent' must be an object if specified");
  }

  if (typeof agent.command !== "string") {
    throw new Error("Config 'acp.agent' must specify 'command' as a string");
  }

  if (agent.args !== undefined && !Array.isArray(agent.args)) {
    throw new Error("Config 'acp.agent.args' must be an array if specified");
  }

  if (agent.args !== undefined) {
    for (const arg of agent.args) {
      if (typeof arg !== "string") {
        throw new Error("Config 'acp.agent.args' must contain only strings");
      }
    }
  }

  if (agent.env !== undefined) {
    if (typeof agent.env !== "object" || agent.env === null) {
      throw new Error("Config 'acp.agent.env' must be an object if specified");
    }

    for (const [key, value] of Object.entries(agent.env)) {
      if (typeof value !== "string") {
        throw new Error(`Config 'acp.agent.env.${key}' must be a string`);
      }
    }
  }
}

/**
 * Validates ACP filesystem configuration if provided.
 */
function validateACPFilesystemConfig(
  filesystem: NonNullable<ServerConfig["acp"]>["filesystem"],
): void {
  if (filesystem === undefined) return;

  if (typeof filesystem !== "object" || filesystem === null) {
    throw new Error("Config 'acp.filesystem' must be an object if specified");
  }

  if (
    filesystem.readTextFile !== undefined &&
    typeof filesystem.readTextFile !== "boolean"
  ) {
    throw new Error(
      "Config 'acp.filesystem.readTextFile' must be a boolean if specified",
    );
  }

  if (
    filesystem.writeTextFile !== undefined &&
    typeof filesystem.writeTextFile !== "boolean"
  ) {
    throw new Error(
      "Config 'acp.filesystem.writeTextFile' must be a boolean if specified",
    );
  }
}

/**
 * Validates ACP allowOwnTools configuration if provided.
 */
function validateAllowOwnToolsConfig(
  allowOwnTools: NonNullable<ServerConfig["acp"]>["allowOwnTools"],
): void {
  if (allowOwnTools === undefined) return;

  if (typeof allowOwnTools !== "object" || allowOwnTools === null) {
    throw new Error(
      "Config 'acp.allowOwnTools' must be an object if specified",
    );
  }

  if (
    allowOwnTools.dangerouslyAllowAll !== undefined &&
    typeof allowOwnTools.dangerouslyAllowAll !== "boolean"
  ) {
    throw new Error(
      "Config 'acp.allowOwnTools.dangerouslyAllowAll' must be a boolean if specified",
    );
  }

  if (allowOwnTools.toolKinds !== undefined) {
    if (!Array.isArray(allowOwnTools.toolKinds)) {
      throw new Error(
        "Config 'acp.allowOwnTools.toolKinds' must be an array if specified",
      );
    }
    for (const kind of allowOwnTools.toolKinds) {
      if (typeof kind !== "string") {
        throw new Error(
          "Config 'acp.allowOwnTools.toolKinds' must contain only strings",
        );
      }
      if (!VALID_TOOL_KINDS.includes(kind)) {
        throw new Error(
          `Config 'acp.allowOwnTools.toolKinds' contains invalid value '${kind}'. Valid: ${VALID_TOOL_KINDS.join(", ")}`,
        );
      }
    }
  }
}

/**
 * Validates the ACP configuration if provided.
 */
function validateACPConfig(config: ServerConfig): void {
  if (config.acp === undefined) return;

  if (typeof config.acp !== "object" || config.acp === null) {
    throw new Error("Config 'acp' must be an object if specified");
  }

  validateACPAgentConfig(config.acp.agent);
  validateACPFilesystemConfig(config.acp.filesystem);
  validateAllowOwnToolsConfig(config.acp.allowOwnTools);
}

/**
 * Validates the database configuration if provided.
 */
function validateDatabaseConfig(config: ServerConfig): void {
  if (config.database === undefined) return;

  if (typeof config.database !== "object" || config.database === null) {
    throw new Error("Config 'database' must be an object if specified");
  }

  if (config.database.retentionDays !== undefined) {
    if (
      typeof config.database.retentionDays !== "number" ||
      config.database.retentionDays <= 0
    ) {
      throw new Error(
        "Config 'database.retentionDays' must be a positive number if specified",
      );
    }
  }
}

/**
 * Validates the logging configuration if provided.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
function validateLoggingConfig(config: ServerConfig): void {
  if (config.logging === undefined) return;

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
      throw new Error("Config 'logging.file' must be an object if specified");
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

/**
 * Validates the dashboard configuration if provided.
 */
function validateDashboardConfig(config: ServerConfig): void {
  if (config.dashboard === undefined) return;

  if (typeof config.dashboard !== "object" || config.dashboard === null) {
    throw new Error("Config 'dashboard' must be an object if specified");
  }

  if (config.dashboard.port !== undefined) {
    if (typeof config.dashboard.port !== "number") {
      throw new Error("Config 'dashboard.port' must be a number if specified");
    }
    if (
      !Number.isInteger(config.dashboard.port) ||
      config.dashboard.port < 1 ||
      config.dashboard.port > 65535
    ) {
      throw new Error(
        "Config 'dashboard.port' must be an integer between 1 and 65535",
      );
    }
  }

  if (
    config.dashboard.host !== undefined &&
    typeof config.dashboard.host !== "string"
  ) {
    throw new Error("Config 'dashboard.host' must be a string if specified");
  }
}

/**
 * Validates the resultSizeThreshold configuration if provided.
 */
function validateResultSizeThreshold(config: ServerConfig): void {
  if (config.resultSizeThreshold === undefined) return;

  if (
    typeof config.resultSizeThreshold !== "number" ||
    config.resultSizeThreshold < 0
  ) {
    throw new Error(
      "Config 'resultSizeThreshold' must be a non-negative number if specified",
    );
  }
}

/**
 * Validates a single MCP client configuration.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
function validateMcpClientConfig(
  name: string,
  clientConfig: MCPClientConfig,
): void {
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

/**
 * Validates all MCP client configurations.
 */
function validateMcpClientsConfig(config: ServerConfig): void {
  if (
    typeof config.mcpClients !== "object" ||
    config.mcpClients === null ||
    Array.isArray(config.mcpClients)
  ) {
    throw new Error("Config must specify 'mcpClients' as an object");
  }

  for (const [name, clientConfig] of Object.entries(config.mcpClients)) {
    validateMcpClientConfig(name, clientConfig);
  }
}

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
    // eslint-disable-next-line no-console
    console.error(`\n  Created default config at: ${createdPath}`);
    // eslint-disable-next-line no-console
    console.error(`  Edit this file to add your MCP servers.`);
    // eslint-disable-next-line no-console
    console.error(`  See docs/configuration.md for configuration options.\n`);

    // Return the default config directly (we know what we wrote)
    return { ...DEFAULT_CONFIG };
  }

  const configPath = activePath.path;

  try {
    const configContent = readFileSync(configPath, "utf-8");
    const config = JSON.parse(configContent) as ServerConfig;

    // Validate all config sections
    validateMcpClientsConfig(config);
    validateTransportConfig(config);
    validateSkillsConfig(config);
    validateACPConfig(config);
    validateLoggingConfig(config);
    validateDatabaseConfig(config);
    validateDashboardConfig(config);
    validateResultSizeThreshold(config);

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
