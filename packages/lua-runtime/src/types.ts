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
        options?: {
          onprogress?: (progress: {
            progress: number;
            total?: number;
            message?: string;
          }) => void;
        },
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
   * List all available resource templates across connected MCP servers.
   */
  listResourceTemplates(): Promise<unknown>;

  /**
   * Read a specific resource by its URI.
   * @param uri The resource URI (original upstream URI or gw-skill://)
   */
  readResource(uri: string): Promise<unknown>;

  /**
   * List all available prompts across connected MCP servers.
   */
  listPrompts(): Promise<unknown>;

  /**
   * Get a specific prompt by its namespaced name.
   * @param name The namespaced prompt name (server-name/prompt-name)
   * @param args Optional arguments to pass to the prompt
   */
  getPrompt(name: string, args?: Record<string, string>): Promise<unknown>;

  /**
   * Get gateway summary statistics (server counts, tool counts, etc.).
   */
  summaryStats(): Promise<unknown>;

  /**
   * Get completions for a resource template variable or prompt argument.
   * @param params The completion request params (ref + argument + optional context)
   */
  complete(params: {
    ref: { type: string; uri?: string; name?: string };
    argument: { name: string; value: string };
    context?: { arguments?: Record<string, string> };
  }): Promise<unknown>;

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

  /**
   * Partially update an existing skill file using old_string/new_string replacement.
   * Only available when skills are enabled and mutable.
   */
  updateSkill?(
    skillName: string,
    file: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): Promise<unknown>;

  /**
   * Retrieve a previously-offloaded execution result by its execution ID.
   * Only available when result offloading is enabled.
   */
  getResult?(id: string): Promise<unknown>;

  /**
   * Register a resource URI encountered in tool results for routing.
   * Called by the runtime when a tool result contains resource_link or
   * embedded resource content blocks.
   */
  registerResourceUri?(uri: string, serverName: string): void;

  /**
   * Guard that checks whether a tool has been inspected before allowing execution.
   * Throws an error if the tool has not been inspected via tool-details or
   * inspect-tool-response. Called by the runtime before each upstream tool invocation.
   */
  toolCallGuard?(luaServerName: string, luaToolName: string): void;
}

/**
 * Callback interface for logging tool calls made within a Lua script execution.
 * Implementations are provided by the caller to record tool call activity.
 */
export interface IToolCallLog {
  /**
   * Called when a tool call begins.
   * @param serverName The MCP server name (original, not sanitized)
   * @param toolName The tool name (original, not sanitized)
   * @param args JSON-serialized tool arguments
   * @returns A call ID to pass to onToolCallEnd/onToolCallError
   */
  onToolCallStart(serverName: string, toolName: string, args?: string): string;

  /**
   * Called when a tool call completes successfully.
   * @param callId The call ID returned by onToolCallStart
   * @param result JSON-serialized tool call result
   */
  onToolCallEnd(callId: string, result: string): void;

  /**
   * Called when a tool call fails.
   * @param callId The call ID returned by onToolCallStart
   * @param error The error message
   */
  onToolCallError(callId: string, error: string): void;
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
   * @param onProgress Optional callback for aggregated progress notifications
   * @param toolCallLog Optional logger for recording tool calls within the execution
   * @returns The result returned by calling result() in Lua
   */
  executeScript(
    script: string,
    mcpServers: Map<string, IMCPClientSession>,
    gatewayBuiltins: IGatewayBuiltins,
    onProgress?: (progress: number, total?: number, message?: string) => void,
    toolCallLog?: IToolCallLog,
  ): Promise<unknown>;
}
