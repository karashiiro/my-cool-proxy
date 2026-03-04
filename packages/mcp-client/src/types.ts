import type { MCPClientSession } from "./client-session.js";
import type {
  ClientCapabilities,
  LoggingMessageNotification,
} from "@modelcontextprotocol/sdk/types.js";

export type { ILogger } from "@my-cool-proxy/logger";
export type { ClientCapabilities };

/**
 * Result of a client connection attempt.
 */
export interface ClientConnectionResult {
  name: string;
  success: boolean;
  error?: string;
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
    clientCapabilities?: ClientCapabilities,
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
    cwd?: string,
  ): Promise<ClientConnectionResult>;
  getClient(name: string, sessionId: string): Promise<MCPClientSession>;
  getClientsBySession(sessionId: string): Map<string, MCPClientSession>;
  getFailedServers(sessionId: string): Map<string, string>;
  closeSession(sessionId: string): Promise<void>;
  getActiveSessions(): string[];
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
