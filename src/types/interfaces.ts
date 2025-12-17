import type { LuaEngine } from "wasmoon";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface ILuaRuntime {
  getEngine(): Promise<LuaEngine>;
  executeScript(script: string): Promise<unknown>;
  close(): Promise<void>;
}

export interface IMCPClientManager {
  addClient(name: string, endpoint: string, sessionId: string): Promise<void>;
  getClient(name: string, sessionId: string): Promise<Client>;
  getClientsBySession(sessionId: string): Map<string, Client>;
  close(): Promise<void>;
}

export interface ITransportManager {
  getOrCreate(sessionId: string): StreamableHTTPServerTransport;
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

export interface ServerConfig {
  port: number;
  host: string;
  useOAuth: boolean;
  mcpClients: { name: string; endpoint: string }[];
}

export interface ILogger {
  info(message: string, meta?: unknown): void;
  error(message: string, error?: Error): void;
  debug(message: string, meta?: unknown): void;
}
