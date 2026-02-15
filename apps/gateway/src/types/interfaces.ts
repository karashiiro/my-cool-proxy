import type { MCPClientSession } from "@my-cool-proxy/mcp-client";
import type { ACPAgentConfig } from "@my-cool-proxy/acp-client";
import type { IGatewayBuiltins } from "@my-cool-proxy/lua-runtime";
import type { SkillMetadata } from "./skill.js";
import type {
  ClientCapabilities,
  LoggingMessageNotification,
} from "@modelcontextprotocol/sdk/types.js";

export type { ACPAgentConfig, ClientCapabilities, IGatewayBuiltins };

export interface ILuaRuntime {
  executeScript(
    script: string,
    mcpServers: Map<string, MCPClientSession>,
    gatewayBuiltins: IGatewayBuiltins,
  ): Promise<unknown>;
}

export interface ClientConnectionResult {
  name: string;
  success: boolean;
  error?: string;
}

export interface IMCPClientManager {
  addHttpClient(
    name: string,
    endpoint: string,
    sessionId: string,
    headers?: Record<string, string>,
    allowedTools?: string[],
    clientCapabilities?: ClientCapabilities,
    dangerouslyEnableSampling?: boolean,
  ): Promise<ClientConnectionResult>;
  addStdioClient(
    name: string,
    command: string,
    sessionId: string,
    args?: string[],
    env?: Record<string, string>,
    allowedTools?: string[],
    clientCapabilities?: ClientCapabilities,
    stderrLogPath?: string,
    dangerouslyEnableSampling?: boolean,
  ): Promise<ClientConnectionResult>;
  getClient(name: string, sessionId: string): Promise<MCPClientSession>;
  getClientsBySession(sessionId: string): Map<string, MCPClientSession>;
  /**
   * Get servers that failed to connect for a given session.
   * Failed servers are tracked from connection attempts and remain until
   * the session is closed via closeSession() or close().
   * @param sessionId - The session ID to get failed servers for
   * @returns Map of server name to error message
   */
  getFailedServers(sessionId: string): Map<string, string>;
  /**
   * Close all clients and clear failed server records for a specific session.
   * Should be called when a session terminates to prevent memory leaks.
   * @param sessionId - The session ID to clean up
   */
  closeSession(sessionId: string): Promise<void>;
  setResourceListChangedHandler(
    handler: (serverName: string, sessionId: string) => void,
  ): void;
  setPromptListChangedHandler(
    handler: (serverName: string, sessionId: string) => void,
  ): void;
  setToolListChangedHandler(
    handler: (serverName: string, sessionId: string) => void,
  ): void;
  setLoggingMessageHandler(
    handler: (
      params: LoggingMessageNotification["params"],
      sessionId: string,
    ) => void,
  ): void;
  close(): Promise<void>;
}

export interface IAuthStrategy {
  authenticate(token: string): Promise<AuthInfo | null>;
}

export interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
}

/**
 * Common configuration options shared by all MCP client types.
 */
export interface MCPClientConfigBase {
  /**
   * List of tool names to expose from this server.
   * If undefined, all tools are exposed. If empty array, no tools are exposed.
   */
  allowedTools?: string[];
  /**
   * DANGEROUS: Enable sampling requests for this server.
   * Sampling allows servers to request the AI client to create messages,
   * potentially accessing your system through the downstream client.
   * Only enable this for servers you fully trust with system access.
   * Default: false
   */
  dangerouslyEnableSampling?: boolean;
}

export interface MCPClientConfigHTTP extends MCPClientConfigBase {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export interface MCPClientConfigStdio extends MCPClientConfigBase {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type MCPClientConfig = MCPClientConfigHTTP | MCPClientConfigStdio;

/**
 * Configuration for ACP filesystem capabilities.
 * Controls what filesystem operations ACP agents can perform.
 * Both options default to false (secure by default).
 */
export interface ACPFilesystemConfig {
  /**
   * Enable reading text files within the session's working directory.
   * When enabled, agents can read files but only within their sandbox.
   * Default: false
   */
  readTextFile?: boolean;

  /**
   * Enable writing text files within the session's working directory.
   * When enabled, agents can write files but only within their sandbox.
   * Default: false
   */
  writeTextFile?: boolean;
}

/**
 * Configuration for auto-approving ACP agent tool calls based on tool kind.
 * Allows fine-grained control over which tool categories are auto-approved.
 */
export interface ACPAllowOwnToolsConfig {
  /**
   * DANGEROUS: Auto-approve ALL permission requests regardless of tool kind.
   * Supersedes toolKinds if set to true.
   * Default: false
   */
  dangerouslyAllowAll?: boolean;

  /**
   * List of tool kinds to auto-approve (e.g., ["read", "search", "think"]).
   * Valid values: read, edit, delete, move, search, execute, think, fetch, switch_mode, other
   * Default: [] (no auto-approval by kind)
   */
  toolKinds?: string[];
}

/**
 * Configuration for ACP (Agent Client Protocol) features.
 * Currently supports configuring an ACP agent for sampling shim.
 */
export interface ACPConfig {
  agent?: ACPAgentConfig;

  /**
   * Filesystem capabilities for ACP agents.
   * Controls whether agents can read/write files within their session sandbox.
   * Default: undefined (no filesystem access)
   */
  filesystem?: ACPFilesystemConfig;

  /**
   * Auto-approval settings for ACP agent tool calls.
   * Allows safe tool kinds to be auto-approved without user intervention.
   * Default: undefined (no auto-approval)
   */
  allowOwnTools?: ACPAllowOwnToolsConfig;
}

/**
 * Service that provides sampling capability when the downstream client
 * does not natively support it, by routing requests through an ACP agent.
 */
export interface ISamplingShim {
  /**
   * Initialize the shim for a gateway session.
   * Spawns an ACP agent process and establishes a connection.
   */
  initialize(sessionId: string): Promise<void>;

  /**
   * Handle a sampling request by forwarding it through the ACP agent.
   * Creates a new ACP session for each request.
   *
   * Returns `CreateMessageResult` (single content block) for standard responses,
   * or `CreateMessageResultWithTools` (content array with tool_use blocks) when
   * the request includes tools and the model returns tool calls.
   *
   * Note: The current ACP-based implementation always returns `CreateMessageResult`
   * since ACP responses don't contain tool blocks. The union type allows for future
   * expansion and matches the MCP SDK's `createMessage()` return type.
   */
  handleSamplingRequest(
    sessionId: string,
    params: import("@modelcontextprotocol/sdk/types.js").CreateMessageRequest["params"],
  ): Promise<
    | import("@modelcontextprotocol/sdk/types.js").CreateMessageResult
    | import("@modelcontextprotocol/sdk/types.js").CreateMessageResultWithTools
  >;

  /**
   * Register a callback that retrieves roots from the downstream client.
   * Called per-session so the shim can resolve a project root as cwd.
   */
  setRootsProvider(
    sessionId: string,
    provider: () => Promise<
      import("@modelcontextprotocol/sdk/types.js").ListRootsResult
    >,
  ): void;

  /**
   * Close the ACP agent for a specific session.
   */
  close(sessionId: string): Promise<void>;

  /**
   * Close all ACP agents across all sessions.
   */
  closeAll(): Promise<void>;
}

/**
 * Configuration for the skills feature.
 */
export interface SkillsConfig {
  /**
   * Enable skill discovery and skill-related Lua builtins.
   * When enabled, the gateway exposes skill URIs and _gateway.invoke_skill_script() builtin.
   * Default: false
   */
  enabled?: boolean;

  /**
   * Allow creating and modifying skills via _gateway.write_skill() Lua builtin.
   * Only takes effect if `enabled` is true.
   * Default: false
   */
  mutable?: boolean;
}

/**
 * Valid log levels supported by the logger.
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Configuration for logging output.
 * Allows independent log level configuration for console and file outputs.
 */
export interface LoggingConfig {
  /**
   * Console output configuration.
   * Console always outputs to stderr using human-readable format.
   */
  console?: {
    /**
     * Log level for console output.
     * Default: "info"
     */
    level?: LogLevel;
  };
  /**
   * File output configuration.
   * File output is always enabled at the platform-specific log path.
   */
  file?: {
    /**
     * Log level for file output.
     * Default: "trace" (captures all logs)
     */
    level?: LogLevel;
  };
}

export interface ServerConfig {
  port?: number;
  host?: string;
  transport?: "http" | "stdio";
  mcpClients: Record<string, MCPClientConfig>;
  /**
   * Skills feature configuration.
   * Skills are reusable instruction sets that extend the gateway's capabilities.
   */
  skills?: SkillsConfig;
  /**
   * ACP (Agent Client Protocol) configuration.
   * Enables routing capabilities through an ACP agent when the downstream
   * client doesn't natively support them.
   */
  acp?: ACPConfig;
  /**
   * Logging configuration.
   * Controls log levels for console and file outputs.
   *
   * Default behavior (no config):
   * - Console: "info" level to stderr
   * - File: "trace" level to platform log directory
   */
  logging?: LoggingConfig;
}

export type { ILogger } from "@my-cool-proxy/logger";

export interface ServerInfo {
  luaIdentifier: string;
  serverInfo: {
    name?: string;
    description?: string;
    version?: string;
    instructions?: string;
  };
}

export interface ServerError {
  luaIdentifier: string;
  error: string;
}

export type ServerListItem = ServerInfo | ServerError;

export interface ToolInfo {
  luaName: string;
  description: string;
}

export interface IShutdownHandler {
  shutdown(): Promise<void>;
}

export interface ICacheService<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
  has(key: string): boolean;
}

/**
 * Store for tracking downstream client capabilities per session.
 * Used to determine what capabilities to advertise to upstream servers.
 */
export interface ICapabilityStore {
  /**
   * Store capabilities for a session.
   */
  setCapabilities(sessionId: string, caps: ClientCapabilities): void;

  /**
   * Get capabilities for a session.
   */
  getCapabilities(sessionId: string): ClientCapabilities | undefined;

  /**
   * Check if a session has a specific capability.
   */
  hasCapability(
    sessionId: string,
    capability: "sampling" | "elicitation",
  ): boolean;

  /**
   * Check if a session has a specific elicitation mode.
   */
  hasElicitationMode(sessionId: string, mode: "form" | "url"): boolean;

  /**
   * Remove capabilities for a session (cleanup).
   */
  deleteCapabilities(sessionId: string): void;

  /**
   * Store the working directory for a session.
   * This is either a valid local root from the client, or a tempdir.
   */
  setWorkingDirectory(sessionId: string, cwd: string): void;

  /**
   * Get the working directory for a session.
   * Returns undefined if not set.
   */
  getWorkingDirectory(sessionId: string): string | undefined;
}

/**
 * Preloaded server information gathered at startup.
 * Used to populate gateway instructions before downstream clients connect.
 */
export interface PreloadedServerInfo {
  name: string;
  serverName?: string;
  description?: string;
  version?: string;
  instructions?: string;
  toolNames?: string[];
}

/**
 * Service for preloading MCP server information at startup.
 */
export interface IServerInfoPreloader {
  /**
   * Probe all configured MCP servers and gather their info.
   * This creates temporary connections just to get server metadata.
   */
  preloadServerInfo(config: ServerConfig): Promise<PreloadedServerInfo[]>;

  /**
   * Build aggregated instructions from preloaded server info.
   * Returns a formatted string suitable for the gateway's instructions field.
   */
  buildAggregatedInstructions(servers: PreloadedServerInfo[]): string;

  /**
   * Build skill instructions section from discovered skills.
   * Returns a formatted string with skill metadata in XML format.
   * Returns empty string if no skills are available.
   */
  buildSkillInstructions(skills: SkillMetadata[]): string;
}

// Re-export skill types for convenience
export type { ISkillDiscoveryService } from "./skill.js";
export type { SkillMetadata };
