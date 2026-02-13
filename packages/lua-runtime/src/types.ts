import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export type { ILogger } from "@my-cool-proxy/logger";

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
 * Interface for gateway built-in functions that are injected into the Lua runtime.
 * These provide access to gateway functionality from within Lua scripts.
 */
export interface IGatewayBuiltins {
  /**
   * List all available resources across connected MCP servers.
   */
  listResources(): Promise<unknown>;

  /**
   * Read a specific resource by its namespaced URI.
   * @param uri The namespaced resource URI (gw:// or gw-skill://)
   */
  readResource(uri: string): Promise<unknown>;

  /**
   * Get gateway summary statistics (server counts, tool counts, etc.).
   */
  summaryStats(): Promise<unknown>;

  /**
   * Execute a script from a skill's scripts/ directory.
   * Only available when skills are enabled.
   */
  invokeSkillScript?(
    skillName: string,
    script: string,
    args?: string[],
  ): Promise<unknown>;

  /**
   * Create or modify a gateway skill.
   * Only available when skills are enabled and mutable.
   */
  writeSkill?(
    skillName: string,
    content?: string,
    files?: Array<{ path: string; content: string }>,
  ): Promise<unknown>;
}

/**
 * Interface for Lua runtime implementations
 */
export interface ILuaRuntime {
  /**
   * Execute a Lua script with injected MCP servers and gateway builtins
   * @param script The Lua source code to execute
   * @param mcpServers Map of server name to client session
   * @param gatewayBuiltins Gateway built-in functions to inject
   * @returns The result returned by calling result() in Lua
   */
  executeScript(
    script: string,
    mcpServers: Map<string, IMCPClientSession>,
    gatewayBuiltins: IGatewayBuiltins,
  ): Promise<unknown>;
}
