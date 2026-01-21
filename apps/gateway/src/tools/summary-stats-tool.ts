import { injectable } from "inversify";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ITool, ToolExecutionContext } from "./base-tool.js";
import type { IMCPClientManager, ILogger } from "../types/interfaces.js";
import { ResourceAggregationService } from "../mcp/resource-aggregation-service.js";
import { PromptAggregationService } from "../mcp/prompt-aggregation-service.js";

/**
 * Tool that provides summary statistics about the gateway.
 *
 * Returns counts of connected servers, tools, resources, and prompts
 * across all MCP servers in the current session.
 */
@injectable()
export class SummaryStatsTool implements ITool {
  readonly name = "summary";
  readonly description =
    "Get a quick summary of the gateway: total number of connected MCP servers, " +
    "and aggregate counts of tools, resources, and prompts across all servers.";
  readonly schema = {};

  constructor(
    @$inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @$inject(TYPES.ResourceAggregationService)
    private resourceAggregation: ResourceAggregationService,
    @$inject(TYPES.PromptAggregationService)
    private promptAggregation: PromptAggregationService,
    @$inject(TYPES.Logger) private logger: ILogger,
  ) {}

  async execute(
    _args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    const sessionId = context.sessionId || "default";

    try {
      const clients = this.clientPool.getClientsBySession(sessionId);
      const failedServers = this.clientPool.getFailedServers(sessionId);

      const connectedCount = clients.size;
      const failedCount = failedServers.size;
      const totalServers = connectedCount + failedCount;

      // Count tools across all connected servers
      let totalTools = 0;
      const toolCountPromises = Array.from(clients.values()).map(
        async (client) => {
          try {
            const tools = await client.listTools();
            return tools.length;
          } catch {
            return 0;
          }
        },
      );
      const toolCounts = await Promise.all(toolCountPromises);
      totalTools = toolCounts.reduce((sum, count) => sum + count, 0);

      // Get resources count
      const resourcesResult =
        await this.resourceAggregation.listResources(sessionId);
      const totalResources = resourcesResult.resources.length;

      // Get prompts count
      const promptsResult = await this.promptAggregation.listPrompts(sessionId);
      const totalPrompts = promptsResult.prompts.length;

      const lines = [
        `Gateway Summary`,
        `===============`,
        ``,
        `Servers: ${connectedCount} connected` +
          (failedCount > 0 ? `, ${failedCount} failed` : "") +
          ` (${totalServers} total)`,
        `Tools: ${totalTools}`,
        `Resources: ${totalResources}`,
        `Prompts: ${totalPrompts}`,
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (error) {
      this.logger.error("Failed to gather summary stats:", error as Error);
      return {
        content: [
          { type: "text", text: `Failed to gather summary stats: ${error}` },
        ],
        isError: true,
      };
    }
  }
}
