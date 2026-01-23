import type {
  Tool,
  Resource,
  Prompt,
  ReadResourceResult,
  GetPromptResult,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Minimal logger interface
 */
export interface ILogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: Error): void;
  debug(message: string): void;
}

/**
 * Cache service interface
 */
export interface ICacheService<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  has(key: string): boolean;
  clear(): void;
}

/**
 * Interface for MCP client sessions used by aggregation services.
 * This is a minimal subset of what the full MCPClientSession provides.
 */
export interface IMCPClientSession {
  /** List available tools from the MCP server */
  listTools(): Promise<Tool[]>;

  /** List available resources from the MCP server */
  listResources(): Promise<Resource[]>;

  /** Read a specific resource */
  readResource(params: { uri: string }): Promise<ReadResourceResult>;

  /** List available prompts from the MCP server */
  listPrompts(): Promise<Prompt[]>;

  /** Get a specific prompt */
  getPrompt(params: {
    name: string;
    arguments?: Record<string, string>;
  }): Promise<GetPromptResult>;

  /** Get server version info */
  getServerVersion():
    | { name?: string; version?: string; description?: string }
    | undefined;

  /** Get server instructions */
  getInstructions(): string | undefined;
}

/**
 * Interface for MCP client manager used by aggregation services
 */
export interface IMCPClientManager {
  /** Get all clients for a session */
  getClientsBySession(sessionId: string): Map<string, IMCPClientSession>;

  /** Get all failed servers for a session */
  getFailedServers(sessionId: string): Map<string, string>;
}

/**
 * Interface for Lua runtime used by tool discovery (for inspect-tool-response)
 */
export interface ILuaRuntime {
  /** Execute a Lua script with injected MCP servers */
  executeScript(
    script: string,
    mcpServers: Map<string, IMCPClientSession>,
  ): Promise<unknown>;
}

/**
 * Server list item for list-servers response
 */
export type ServerListItem =
  | {
      luaIdentifier: string;
      serverInfo: {
        name?: string;
        version?: string;
        description?: string;
        instructions?: string;
      };
    }
  | {
      luaIdentifier: string;
      error: string;
    };

/**
 * Tool info for list-server-tools response
 */
export interface ToolInfo {
  luaName: string;
  description: string;
}
