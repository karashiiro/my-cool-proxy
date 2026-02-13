import { injectable } from "inversify";
import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ITool, ToolExecutionContext } from "./base-tool.js";
import type { ServerConfig } from "../types/interfaces.js";
import { ToolDiscoveryService } from "@my-cool-proxy/mcp-aggregation";
import { SKILLS_REMINDER_CONTENT_BLOCK } from "../utils/skills.js";
import { getEffectiveSessionId } from "../utils/session.js";
import { luaServerNameSchema } from "./schemas.js";

/**
 * Tool that lists all tools available on a specific MCP server.
 *
 * This tool is used to discover what tools a particular MCP server provides,
 * using the server's Lua identifier.
 */
@injectable()
export class ListServerToolsTool implements ITool {
  readonly name = "list-server-tools";
  readonly description =
    "List all tools provided by a specific MCP server. Use this after calling list-servers to explore " +
    "what operations each server supports. Returns tool names with brief descriptions, allowing you to " +
    "identify which tools might be relevant for your task. Once you've identified relevant tools, use " +
    "tool-details to get complete information before calling them.";
  readonly schema = {
    luaServerName: luaServerNameSchema.describe(
      "The Lua identifier of the MCP server to list tools for",
    ),
  };
  readonly annotations: ToolAnnotations = {
    title: "List Server Tools",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  };

  constructor(
    @$inject(TYPES.ToolDiscoveryService)
    private toolDiscovery: ToolDiscoveryService,
    @$inject(TYPES.ServerConfig)
    private config: ServerConfig,
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    const { luaServerName } = args;
    const result = await this.toolDiscovery.listServerTools(
      luaServerName as string,
      getEffectiveSessionId(context.sessionId),
    );

    // Add skill check note if skills are enabled
    if (this.config.skills?.enabled === true) {
      result.content.push(SKILLS_REMINDER_CONTENT_BLOCK);
    }

    return result;
  }
}
