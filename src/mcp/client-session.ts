import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ILogger } from "../types/interfaces.js";
import {
  ToolListChangedNotificationSchema,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

export class MCPClientSession {
  private client: Client;
  private allowedTools: string[] | undefined;
  private logger: ILogger;
  private serverName: string;
  private cachedToolList: ListToolsResult | undefined;

  constructor(
    client: Client,
    serverName: string,
    allowedTools: string[] | undefined,
    logger: ILogger,
  ) {
    this.client = client;
    this.serverName = serverName;
    this.allowedTools = allowedTools;
    this.logger = logger;
    this.cachedToolList = undefined;

    // Register notification handler for tool list changes
    this.setupNotificationHandlers();
  }

  private setupNotificationHandlers(): void {
    // Handle tools/list_changed notifications
    this.client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        this.logger.info(
          `Server '${this.serverName}': Tool list changed, invalidating cache`,
        );
        this.clearToolCache();
      },
    );
  }

  private clearToolCache(): void {
    this.cachedToolList = undefined;
  }

  // Wrap listTools to filter results
  async listTools() {
    // Return cached response if available
    if (this.cachedToolList !== undefined) {
      this.logger.debug(
        `Server '${this.serverName}': Returning cached tool list`,
      );
      return this.cachedToolList;
    }

    // Fetch fresh tool list from server
    const response = await this.client.listTools();
    const allTools = response.tools;

    let filteredResponse;

    // If no filter, return all tools
    if (this.allowedTools === undefined) {
      filteredResponse = response;
    } else if (this.allowedTools.length === 0) {
      // If empty array, return no tools
      this.logger.info(
        `Server '${this.serverName}': All tools blocked by empty allowedTools array`,
      );
      filteredResponse = { ...response, tools: [] };
    } else {
      // Filter to only allowed tools
      const allowedSet = new Set(this.allowedTools);
      const filteredTools = allTools.filter((tool) =>
        allowedSet.has(tool.name),
      );

      // Log warnings for tools in allowedTools that don't exist
      const actualToolNames = new Set(allTools.map((t) => t.name));
      for (const allowedTool of this.allowedTools) {
        if (!actualToolNames.has(allowedTool)) {
          this.logger.error(
            `Server '${this.serverName}': Tool '${allowedTool}' in allowedTools not found. Available: ${Array.from(actualToolNames).join(", ")}`,
          );
        }
      }

      this.logger.info(
        `Server '${this.serverName}': Filtered to ${filteredTools.length} of ${allTools.length} tools: ${filteredTools.map((t) => t.name).join(", ")}`,
      );

      filteredResponse = { ...response, tools: filteredTools };
    }

    // Cache the filtered response
    this.cachedToolList = filteredResponse;

    return filteredResponse;
  }

  // Pass through other methods we need
  get experimental() {
    return this.client.experimental;
  }

  async close() {
    return this.client.close();
  }
}
