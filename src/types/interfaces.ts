import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { MCPClientSession } from "../mcp/client-session.js";

export interface ILuaRuntime {
  executeScript(
    script: string,
    mcpServers: Map<string, MCPClientSession>,
  ): Promise<unknown>;
}

export interface IMCPClientManager {
  addHttpClient(
    name: string,
    endpoint: string,
    sessionId: string,
    headers?: Record<string, string>,
    allowedTools?: string[],
  ): Promise<void>;
  addStdioClient(
    name: string,
    command: string,
    sessionId: string,
    args?: string[],
    env?: Record<string, string>,
    allowedTools?: string[],
  ): Promise<void>;
  getClient(name: string, sessionId: string): Promise<MCPClientSession>;
  getClientsBySession(sessionId: string): Map<string, MCPClientSession>;
  setResourceListChangedHandler(
    handler: (serverName: string, sessionId: string) => void,
  ): void;
  setPromptListChangedHandler(
    handler: (serverName: string, sessionId: string) => void,
  ): void;
  close(): Promise<void>;
}

export interface ITransportManager {
  getOrCreate(sessionId: string): StreamableHTTPServerTransport;
  getOrCreateForRequest(sessionId?: string): StreamableHTTPServerTransport;
  has(sessionId: string): boolean;
  remove(sessionId: string): void;
  closeAll(): Promise<void>;
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
  port: number;
  host: string;
  mcpClients: Record<string, MCPClientConfig>;
}

export interface ILogger {
  info(message: string, meta?: unknown): void;
  error(message: string, error?: Error): void;
  debug(message: string, meta?: unknown): void;
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
