import { injectable, inject } from "inversify";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { TYPES } from "../types/index.js";
import type { ITool, ToolExecutionContext } from "./base-tool.js";
import { ToolDiscoveryService } from "../mcp/tool-discovery-service.js";

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
    "Get detailed information about a specific tool including full description and schemas";
  readonly schema = {
    luaServerName: z.string().describe("The Lua identifier of the MCP server"),
    luaToolName: z.string().describe("The Lua identifier of the tool"),
  };

  constructor(
    @inject(TYPES.ToolDiscoveryService)
    private toolDiscovery: ToolDiscoveryService,
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    const { luaServerName, luaToolName } = args;
    return this.toolDiscovery.getToolDetails(
      luaServerName as string,
      luaToolName as string,
      context.sessionId || "default",
    );
  }
}
