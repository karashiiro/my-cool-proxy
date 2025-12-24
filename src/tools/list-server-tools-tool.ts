import { injectable } from "inversify";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { $inject } from "../container/decorators.js";
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
    "List all tools provided by a specific MCP server. Use this after calling list-servers to explore " +
    "what operations each server supports. Returns tool names with brief descriptions, allowing you to " +
    "identify which tools might be relevant for your task. Once you've identified relevant tools, use " +
    "tool-details to get complete information before calling them.";
  readonly schema = {
    luaServerName: z
      .string()
      .describe("The Lua identifier of the MCP server to list tools for"),
  };

  constructor(
    @$inject("ToolDiscoveryService")
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
