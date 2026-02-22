import { injectable } from "inversify";
import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ITool, ToolExecutionContext } from "./base-tool.js";
import { ToolDiscoveryService } from "@my-cool-proxy/mcp-aggregation";
import type { IToolInspectionStore } from "../types/interfaces.js";
import { getEffectiveSessionId } from "../utils/session.js";
import { luaServerNameSchema, luaToolNameSchema } from "./schemas.js";

/**
 * Tool that provides detailed information about a specific tool on an MCP server.
 *
 * This tool returns comprehensive details including the full description,
 * input schema, and example usage for a specific tool.
 */
@injectable()
export class ToolDetailsTool implements ITool {
  readonly name = "tool-details";
  readonly description =
    "Get comprehensive information about a specific tool, including its full description, input schema " +
    "with required/optional parameters, and expected output format. You MUST call this for each tool " +
    "you plan to use - the brief descriptions from list-server-tools are insufficient for making actual " +
    "tool calls. This ensures you understand the tool's capabilities and provide correct arguments. " +
    "If you need to understand the output structure for efficient data extraction, use inspect-tool-response " +
    "after this (but only for safe/read-only tools).";
  readonly schema = {
    luaServerName: luaServerNameSchema,
    luaToolName: luaToolNameSchema,
  };
  readonly annotations: ToolAnnotations = {
    title: "Get Tool Details",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  };

  constructor(
    @$inject(TYPES.ToolDiscoveryService)
    private toolDiscovery: ToolDiscoveryService,
    @$inject(TYPES.ToolInspectionStore)
    private inspectionStore: IToolInspectionStore,
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    const { luaServerName, luaToolName } = args;
    const sessionId = getEffectiveSessionId(context.sessionId);
    const result = await this.toolDiscovery.getToolDetails(
      luaServerName as string,
      luaToolName as string,
      sessionId,
    );

    // Record successful inspection so the execute tool allows this tool call
    if (!result.isError) {
      this.inspectionStore.markInspected(
        sessionId,
        luaServerName as string,
        luaToolName as string,
      );
    }

    return result;
  }
}
