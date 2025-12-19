import { injectable, inject } from "inversify";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { TYPES } from "../types/index.js";
import type { ITool, ToolExecutionContext } from "./base-tool.js";
import { ToolDiscoveryService } from "../mcp/tool-discovery-service.js";

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
    "List all available tools for a specific MCP server using its Lua identifier";
  readonly schema = {
    luaServerName: z
      .string()
      .describe("The Lua identifier of the MCP server to list tools for"),
  };

  constructor(
    @inject(TYPES.ToolDiscoveryService)
    private toolDiscovery: ToolDiscoveryService,
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    const { luaServerName } = args;
    return this.toolDiscovery.listServerTools(
      luaServerName as string,
      context.sessionId || "default",
    );
  }
}
