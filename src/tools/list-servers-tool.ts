import { injectable, inject } from "inversify";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TYPES } from "../types/index.js";
import type { ITool, ToolExecutionContext } from "./base-tool.js";
import { ToolDiscoveryService } from "../mcp/tool-discovery-service.js";

/**
 * Tool that lists all available MCP servers for the current session.
 *
 * This tool provides information about connected MCP servers, including
 * their Lua identifiers and server metadata.
 */
@injectable()
export class ListServersTool implements ITool {
  readonly name = "list-servers";
  readonly description =
    "List all available MCP servers for this session, including their Lua identifiers and server information";
  readonly schema = {};

  constructor(
    @inject(TYPES.ToolDiscoveryService)
    private toolDiscovery: ToolDiscoveryService,
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    return this.toolDiscovery.listServers(context.sessionId || "default");
  }
}
