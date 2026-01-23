import type { MCPClientSession } from "./client-session.js";

/**
 * Logger interface required by MCP client components.
 */
export interface ILogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: Error): void;
  debug(message: string): void;
}

/**
 * Result of a client connection attempt.
 */
export interface ClientConnectionResult {
  name: string;
  success: boolean;
  error?: string;
}

/**
 * Downstream client capabilities for proxying.
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
 * Interface for the MCP client manager.
 */
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
  getFailedServers(sessionId: string): Map<string, string>;
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

/**
 * Generic cache service interface.
 */
export interface ICacheService<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
  has(key: string): boolean;
}
