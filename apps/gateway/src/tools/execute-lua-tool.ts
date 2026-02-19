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
import type {
  ILuaRuntime,
  IMCPClientManager,
  ILogger,
  ServerConfig,
  ISkillDiscoveryService,
  ISkillOperationsService,
  IToolInspectionStore,
  IGatewayBuiltins,
} from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ITool, ToolExecutionContext } from "./base-tool.js";
import { getEffectiveSessionId } from "../utils/session.js";
import { GatewayBuiltinsBuilder } from "./gateway-builtins-builder.js";

/**
 * Tool that executes Lua scripts with access to MCP servers.
 *
 * This tool allows executing arbitrary Lua code that can call tools on
 * available MCP servers. It's the primary way to orchestrate multi-server
 * tool calls.
 */
const BASE_DESCRIPTION = `Execute a Lua script that orchestrates tool calls across MCP servers. This is the primary way to use specialized tools discovered through this gateway.

WORKFLOW:
1. Call list-servers to discover available MCP servers
2. Call list-server-tools to see what each server provides
3. Call tool-details for each tool you plan to use (REQUIRED - brief descriptions are insufficient)
4. OPTIONAL: Call inspect-tool-response to see sample output structure for better data extraction
5. Call execute with a Lua script that uses those tools

SCRIPT SYNTAX:
- MCP servers are available as global variables using their Lua identifiers
- Tool calls return promises - use :await() to unwrap them
- Call result() to return a value from your script
- Example: result(server_name.tool_name({ arg = "value" }):await())

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
- _gateway.summary_stats():await() - Get gateway statistics (server/tool/resource/prompt counts)`;

const SKILLS_NOTE = `

SKILLS:
Gateway skills are enabled. Before executing scripts, strongly consider checking for applicable skills
that may provide optimized workflows or best practices for your task.

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
  ) {
    this.description =
      this.config.skills?.enabled === true
        ? BASE_DESCRIPTION + SKILLS_NOTE
        : BASE_DESCRIPTION;
  }

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    const { script } = args;
    const sessionId = getEffectiveSessionId(context.sessionId);
    const mcpServers = this.clientPool.getClientsBySession(sessionId);
    const gatewayBuiltins = this.buildGatewayBuiltins(sessionId);

    try {
      const result = await this.luaRuntime.executeScript(
        script as string,
        mcpServers,
        gatewayBuiltins,
        context.sendProgress,
      );

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
      this.logger.error("Lua script execution failed:", error as Error);
      return {
        content: [{ type: "text", text: `Script execution failed:\n${error}` }],
        isError: true,
      };
    }
  }

  /**
   * Build gateway builtins object for the current session.
   * Delegates to GatewayBuiltinsBuilder with all injected dependencies.
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
    ).build(sessionId);
  }
}
