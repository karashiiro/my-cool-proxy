import type { MCPClientSession } from "../mcp/client-session.js";

export interface ILuaRuntime {
  executeScript(
    script: string,
    mcpServers: Map<string, MCPClientSession>,
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
    clientCapabilities?: DownstreamCapabilities,
  ): Promise<ClientConnectionResult>;
  addStdioClient(
    name: string,
    command: string,
    sessionId: string,
    args?: string[],
    env?: Record<string, string>,
    allowedTools?: string[],
    clientCapabilities?: DownstreamCapabilities,
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
  close(): Promise<void>;
}

export interface ISessionStore {
  create(sessionId: string, data: unknown): void;
  get(sessionId: string): unknown | undefined;
  delete(sessionId: string): void;
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

export interface MCPClientConfigHTTP {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  allowedTools?: string[];
}

export interface MCPClientConfigStdio {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  allowedTools?: string[];
}

export type MCPClientConfig = MCPClientConfigHTTP | MCPClientConfigStdio;

export interface ServerConfig {
  port?: number;
  host?: string;
  transport?: "http" | "stdio";
  mcpClients: Record<string, MCPClientConfig>;
}

export interface ILogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: Error): void;
  debug(message: string): void;
}

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
 * Downstream client capabilities that we care about for proxying.
 * These are the capabilities that affect what we can forward to downstream clients.
 */
export interface DownstreamCapabilities {
  sampling?: {
    context?: object;
    tools?: object;
  };
  elicitation?: {
    form?: object;
    url?: object;
  };
}

/**
 * Store for tracking downstream client capabilities per session.
 * Used to determine what capabilities to advertise to upstream servers.
 */
export interface ICapabilityStore {
  /**
   * Store capabilities for a session.
   */
  setCapabilities(sessionId: string, caps: DownstreamCapabilities): void;

  /**
   * Get capabilities for a session.
   */
  getCapabilities(sessionId: string): DownstreamCapabilities | undefined;

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
}
