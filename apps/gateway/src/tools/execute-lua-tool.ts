import { injectable } from "inversify";
import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import {
  ResourceAggregationService,
  PromptAggregationService,
  CompletionAggregationService,
  type IResourceRoutingService,
} from "@my-cool-proxy/mcp-aggregation";
import { getErrorMessage } from "@my-cool-proxy/mcp-utilities";
import type {
  ILuaRuntime,
  IMCPClientManager,
  ILogger,
  ServerConfig,
  ISkillDiscoveryService,
  ISkillOperationsService,
  IToolInspectionStore,
  IGatewayBuiltins,
  IExecutionLog,
} from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ITool, ToolExecutionContext } from "./base-tool.js";
import { getEffectiveSessionId } from "../utils/session.js";
import { GatewayBuiltinsBuilder } from "./gateway-builtins-builder.js";
import { maybeOffloadResult } from "./result-offloader.js";
import { validateToolArgs } from "./tool-validation.js";

/**
 * Tool that executes Lua scripts with access to MCP servers.
 *
 * This is the primary execution tool in the gateway — it runs arbitrary Lua
 * code that can orchestrate tool calls across all connected MCP servers.
 *
 * ## Dependency note
 * This tool has a large constructor because it relays most dependencies to
 * `GatewayBuiltinsBuilder` which constructs the `_gateway` global table
 * available inside Lua scripts. The DI container wiring is managed elsewhere.
 */
const BASE_DESCRIPTION = `Execute a Lua script that orchestrates tool calls across MCP servers.

WORKFLOW:
1. Call list-servers to discover the Lua global identifiers for available MCP servers
2. Call list-server-tools to see the Lua identifiers for the tools each server provides
3. (MANDATORY) Call tool-details for each tool you plan to use
4. Call execute with a Lua script that uses those tools

NOTES:
- Tool calls return promises - use :await() to unwrap them
- Call result() to return a value from your script
- Filter tool result objects down to only what you need
- Calling many tools in one script is more efficient than calling execute many times

Most list/search tools paginate results. ALWAYS loop to fetch all pages — a single call typically returns only partial data:
\`\`\`lua
local all_items = {}
local page = 1
while true do
  local res = my_server.list_things({ page = page, perPage = 100 }):await()
  for _, item in ipairs(res.items) do
    table.insert(all_items, { name = item.name, id = item.id })
  end
  if not res.hasNextPage then break end
  page = page + 1
end
result(all_items)
\`\`\`

GATEWAY BUILTINS:
The \`_gateway\` global table provides built-in functions:
- _gateway.list_resources():await() - List all available resources across connected servers
- _gateway.list_resource_templates():await() - List all available resource templates. Use _gateway.complete() to discover valid values for template variables
- _gateway.read_resource({ uri = "..." }):await() - Read a resource by its URI (original upstream URI or gw-skill://)
- _gateway.list_prompts():await() - List all available prompts across connected servers
- _gateway.get_prompt({ name = "...", arguments = {...} }):await() - Get a prompt by namespaced name (server-name/prompt-name). Use _gateway.complete() to discover valid values for prompt arguments
- _gateway.complete({ ref = {...}, argument = { name = "...", value = "..." }, context = { arguments = {...} } }):await() - Get completions for a resource template variable (ref.type = "ref/resource", ref.uri = template URI) or prompt argument (ref.type = "ref/prompt", ref.name = namespaced prompt name). Pass partial value for fuzzy matching. Use context.arguments to provide other already-resolved variables for context-aware suggestions
- _gateway.summary_stats():await() - Get gateway statistics (server/tool/resource/prompt counts)
- _gateway.get_result({ id = "..." }):await() - Retrieve a previously-offloaded execution result by ID. Large results are automatically offloaded with a schema summary; use this to fetch the full data and filter it in Lua`;

const SKILLS_NOTE = `

SKILLS:
Gateway skills are enabled. Before executing scripts, check for applicable skills that may provide optimized workflows or best practices for your task.

Additional skill-related builtins in \`_gateway\`:
- _gateway.invoke_skill_script({ skillName = "...", script = "...", args = {...} }):await() - Execute a skill script
- _gateway.write_skill({ skillName = "...", content = "...", files = {...} }):await() - Create or modify a skill (when mutable)
- _gateway.update_skill({ skillName = "...", file = "SKILL.md", old_string = "...", new_string = "...", replace_all = false }):await() - Partially update an existing skill file using string replacement (when mutable)`;

@injectable()
export class ExecuteLuaTool implements ITool {
  readonly name = "execute";
  readonly description: string;

  readonly schema = {
    script: z
      .string()
      .describe(
        "Lua script to execute. See tool description for syntax and workflow.",
      ),
  };
  readonly annotations: ToolAnnotations = {
    title: "Execute Lua Script",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  };

  constructor(
    @$inject(TYPES.LuaRuntime) private luaRuntime: ILuaRuntime,
    @$inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @$inject(TYPES.Logger) private logger: ILogger,
    @$inject(TYPES.ServerConfig) private config: ServerConfig,
    @$inject(TYPES.ResourceAggregationService)
    private resourceAggregation: ResourceAggregationService,
    @$inject(TYPES.PromptAggregationService)
    private promptAggregation: PromptAggregationService,
    @$inject(TYPES.SkillDiscoveryService)
    private skillDiscoveryService: ISkillDiscoveryService,
    @$inject(TYPES.ResourceRoutingService)
    private routingService: IResourceRoutingService,
    @$inject(TYPES.CompletionAggregationService)
    private completionAggregation: CompletionAggregationService,
    @$inject(TYPES.SkillOperationsService)
    private skillOperations: ISkillOperationsService,
    @$inject(TYPES.ToolInspectionStore)
    private toolInspectionStore: IToolInspectionStore,
    @$inject(TYPES.ExecutionLog)
    private executionLog: IExecutionLog,
  ) {
    this.description =
      this.config.skills?.enabled === true
        ? BASE_DESCRIPTION + SKILLS_NOTE
        : BASE_DESCRIPTION;
  }

  /**
   * Execute a Lua script within the context of the current session.
   *
   * The script has access to all MCP servers (as global Lua variables) and
   * gateway builtins (via the `_gateway` global). Individual tool calls
   * within the script are logged for observability.
   *
   * @param args    - Must contain a `script` string (validated via Zod)
   * @param context - Execution context with session ID and progress callback
   * @returns MCP `CallToolResult` with the script's output or error details
   */
  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    const { script } = validateToolArgs(this.schema, args);
    const sessionId = getEffectiveSessionId(context.sessionId);
    const mcpServers = this.clientPool.getClientsBySession(sessionId);
    const gatewayBuiltins = this.buildGatewayBuiltins(sessionId);

    // Log execution start
    const executionId = this.executionLog.logExecution(sessionId, script);

    // Build tool call log that records individual tool calls within this execution
    const toolCallLog = {
      onToolCallStart: (
        serverName: string,
        toolName: string,
        callArgs?: string,
      ): string =>
        this.executionLog.logToolCall(
          executionId,
          serverName,
          toolName,
          callArgs,
        ),
      onToolCallEnd: (callId: string, result: string): void =>
        this.executionLog.markToolCallResult(callId, result),
      onToolCallError: (callId: string, error: string): void =>
        this.executionLog.markToolCallError(callId, error),
    };

    try {
      const result = await this.luaRuntime.executeScript(
        script,
        mcpServers,
        gatewayBuiltins,
        context.sendProgress,
        toolCallLog,
      );

      // Log the final script result
      if (result !== undefined) {
        this.executionLog.markExecutionResult(
          executionId,
          typeof result === "string" ? result : JSON.stringify(result),
        );
      }

      // Check if result should be offloaded due to size
      const threshold = this.config.resultSizeThreshold ?? 50_000;
      const offloaded = maybeOffloadResult(result, executionId, threshold);
      if (offloaded) return offloaded;

      // Check if result is already a valid CallToolResult
      if (
        result &&
        typeof result === "object" &&
        "content" in result &&
        Array.isArray((result as Record<string, unknown>).content)
      ) {
        const parseResult = CallToolResultSchema.safeParse(result);
        if (parseResult.success) return parseResult.data;
      }

      // Return structured result if it's an object (but not an array)
      if (result !== null && typeof result === "object") {
        const textContent = {
          type: "text" as const,
          text: JSON.stringify(result),
        };

        // structuredContent must be a Record, not an array
        if (Array.isArray(result)) {
          return { content: [textContent] };
        }

        return {
          content: [textContent],
          structuredContent: result as Record<string, unknown>,
        };
      }

      // Return simple text result
      return {
        content: [
          {
            type: "text",
            text:
              result !== undefined
                ? `Script executed successfully.\n\nResult:\n${result}`
                : "Script executed successfully. No result returned.",
          },
        ],
      };
    } catch (error) {
      this.executionLog.markExecutionError(executionId, getErrorMessage(error));
      this.logger.error("Lua script execution failed:", error as Error);
      return {
        content: [
          {
            type: "text",
            text: `Script execution failed:\n${getErrorMessage(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Build gateway builtins object for the current session.
   *
   * Delegates to {@link GatewayBuiltinsBuilder} with all injected dependencies.
   * The resulting object is exposed as the `_gateway` global in Lua scripts.
   */
  private buildGatewayBuiltins(sessionId: string): IGatewayBuiltins {
    return new GatewayBuiltinsBuilder(
      this.resourceAggregation,
      this.promptAggregation,
      this.completionAggregation,
      this.clientPool,
      this.routingService,
      this.skillDiscoveryService,
      this.config.skills?.enabled === true ? this.skillOperations : null,
      this.config,
      this.logger,
      this.toolInspectionStore,
      this.executionLog,
    ).build(sessionId);
  }
}
