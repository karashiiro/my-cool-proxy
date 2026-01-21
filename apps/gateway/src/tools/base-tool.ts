import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Context provided to tool execution
 */
export interface ToolExecutionContext {
  sessionId?: string;
}

/**
 * Base interface for all tools in the gateway server.
 *
 * Tools are self-contained units that can be registered with the tool registry.
 * Each tool defines its own name, description, schema, and execution logic.
 */
export interface ITool {
  /**
   * The unique name of the tool (e.g., "execute", "list-servers")
   */
  readonly name: string;

  /**
   * A human-readable description of what the tool does
   */
  readonly description: string;

  /**
   * The JSON schema for the tool's input parameters
   */
  readonly schema: Record<string, unknown>;

  /**
   * Execute the tool with the given arguments and context
   *
   * @param args - The arguments passed to the tool
   * @param context - Execution context (e.g., sessionId)
   * @returns A CallToolResult containing the tool's output
   */
  execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult>;
}
