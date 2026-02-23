import { injectable } from "inversify";
import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ITool, ToolExecutionContext } from "./base-tool.js";
import type {
  ServerConfig,
  IToolInspectionStore,
} from "../types/interfaces.js";
import { ToolDiscoveryService } from "@my-cool-proxy/mcp-aggregation";
import { SKILLS_REMINDER_CONTENT_BLOCK } from "../utils/skills.js";
import { getEffectiveSessionId } from "../utils/session.js";
import { luaServerNameSchema, luaToolNameSchema } from "./schemas.js";
import { validateToolArgs } from "./tool-validation.js";

/**
 * Tool that inspects a tool's response structure by making a sample call.
 *
 * This tool helps understand what fields a tool returns, enabling more efficient
 * data extraction in subsequent execute scripts. However, it actually invokes
 * the target tool, so it should only be used with safe/idempotent operations.
 */
@injectable()
export class InspectToolResponseTool implements ITool {
  readonly name = "inspect-tool-response";
  readonly description =
    "Get a sample response from a tool to understand its output structure. This helps you write " +
    "optimized scripts that extract only the fields you need.\n\n" +
    "⚠️ WARNING: This tool ACTUALLY EXECUTES the target tool with the provided arguments. " +
    'This is NOT a safe "preview" - it will cause real side effects and may incur costs.\n\n' +
    "WHEN TO USE:\n" +
    "- Read-only/idempotent tools (search, list, get operations)\n" +
    "- Tools with minimal/free sample calls\n" +
    "- When you need to know response structure to write efficient data extraction\n\n" +
    "WHEN NOT TO USE:\n" +
    "- Destructive operations (delete, update, create)\n" +
    "- Expensive API calls (unless necessary)\n" +
    "- Tools with side effects (send email, charge payment, trigger workflows)\n\n" +
    "For tools you cannot safely inspect, write your execute script to handle unknown response " +
    "structures gracefully, or return the full response and accept the token cost.";

  readonly schema = {
    luaServerName: luaServerNameSchema,
    luaToolName: luaToolNameSchema,
    sampleArgs: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Minimal arguments for the sample call (e.g., {limit: 1} for pagination). " +
          "Use the smallest/cheapest request possible to understand the response structure.",
      ),
  };
  readonly annotations: ToolAnnotations = {
    title: "Inspect Tool Response",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  };

  constructor(
    @$inject(TYPES.ToolDiscoveryService)
    private toolDiscovery: ToolDiscoveryService,
    @$inject(TYPES.ServerConfig)
    private config: ServerConfig,
    @$inject(TYPES.ToolInspectionStore)
    private inspectionStore: IToolInspectionStore,
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    const { luaServerName, luaToolName, sampleArgs } = validateToolArgs(
      this.schema,
      args,
    );
    const sessionId = getEffectiveSessionId(context.sessionId);
    const result = await this.toolDiscovery.inspectToolResponse(
      luaServerName,
      luaToolName,
      sampleArgs || {},
      sessionId,
    );

    // Record successful inspection so the execute tool allows this tool call
    if (!result.isError) {
      this.inspectionStore.markInspected(sessionId, luaServerName, luaToolName);
    }

    // Add skill check note if skills are enabled
    if (this.config.skills?.enabled === true) {
      result.content.push(SKILLS_REMINDER_CONTENT_BLOCK);
    }

    return result;
  }
}
