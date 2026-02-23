import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

/**
 * Context provided to tool execution
 */
export interface ToolExecutionContext {
  sessionId?: string;
  /**
   * Send a progress notification to the downstream client.
   * Only available when the downstream request included a progressToken.
   */
  sendProgress?: (progress: number, total?: number, message?: string) => void;
}

/**
 * Schema definition for a tool's input parameters.
 *
 * Each key is a parameter name and each value is a Zod schema that describes
 * the parameter's type and constraints. The MCP framework serializes these
 * to JSON Schema for client-side validation, while `validateToolArgs` uses
 * them for runtime validation on the server side.
 *
 * @example
 * ```ts
 * readonly schema: ToolInputSchema = {
 *   luaServerName: z.string().describe("The Lua identifier of the MCP server"),
 *   limit: z.number().optional().describe("Maximum results to return"),
 * };
 * ```
 */
export type ToolInputSchema = Record<string, z.ZodTypeAny>;

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
   * The input parameter schema for this tool.
   *
   * A record mapping parameter names to Zod schemas. An empty object (`{}`)
   * indicates the tool takes no parameters. The gateway serializes these to
   * JSON Schema for MCP clients and uses them for runtime validation via
   * `validateToolArgs`.
   */
  readonly schema: ToolInputSchema;

  /**
   * Optional annotations providing hints about the tool's behavior.
   * See MCP spec for details on each annotation field.
   */
  readonly annotations?: ToolAnnotations;

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
