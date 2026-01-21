import { injectable } from "inversify";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { $inject } from "../container/decorators.js";
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
    "Discover what specialized MCP servers are available through this gateway. MCP servers provide " +
    "domain-specific tools that are often more powerful, accurate, and efficient than generic " +
    "alternatives. Always call this tool FIRST when starting a new task to see what specialized " +
    "capabilities you have access to. Returns server names with their Lua identifiers for use in " +
    "subsequent discovery (list-server-tools → tool-details → optionally inspect-tool-response) and execution.";
  readonly schema = {};

  constructor(
    @$inject(TYPES.ToolDiscoveryService)
    private toolDiscovery: ToolDiscoveryService,
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    return this.toolDiscovery.listServers(context.sessionId || "default");
  }
}
