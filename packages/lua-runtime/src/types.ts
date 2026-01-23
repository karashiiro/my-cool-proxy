import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Minimal logger interface for the lua-runtime package
 */
export interface ILogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: Error): void;
  debug(message: string): void;
}

/**
 * Interface for MCP client sessions that the Lua runtime uses.
 * This is a minimal subset of what the full MCPClientSession provides.
 */
export interface IMCPClientSession {
  /**
   * List available tools from the MCP server
   */
  listTools(): Promise<Tool[]>;

  /**
   * Access to experimental SDK features (tasks, etc.)
   */
  experimental: {
    tasks: {
      callToolStream(
        params: { name: string; arguments: Record<string, unknown> },
        schema: unknown,
      ): AsyncGenerator<unknown>;
    };
  };

  /**
   * Close the session
   */
  close(): Promise<void>;
}

/**
 * Interface for Lua runtime implementations
 */
export interface ILuaRuntime {
  /**
   * Execute a Lua script with injected MCP servers
   * @param script The Lua source code to execute
   * @param mcpServers Map of server name to client session
   * @returns The result returned by calling result() in Lua
   */
  executeScript(
    script: string,
    mcpServers: Map<string, IMCPClientSession>,
  ): Promise<unknown>;
}
