import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ILogger } from "../types/interfaces.js";
import {
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  type Implementation,
  type ListToolsResult,
  type ListResourcesResult,
  type ListPromptsResult,
} from "@modelcontextprotocol/sdk/types.js";

export class MCPClientSession {
  private client: Client;
  private allowedTools: string[] | undefined;
  private logger: ILogger;
  private serverName: string;
  private cachedToolList: ListToolsResult | undefined;
  private cachedResourceList: ListResourcesResult | undefined;
  private cachedPromptList: ListPromptsResult | undefined;
  private onResourceListChanged?: (serverName: string) => void;

  constructor(
    client: Client,
    serverName: string,
    allowedTools: string[] | undefined,
    logger: ILogger,
    onResourceListChanged?: (serverName: string) => void,
  ) {
    this.client = client;
    this.serverName = serverName;
    this.allowedTools = allowedTools;
    this.logger = logger;
    this.onResourceListChanged = onResourceListChanged;
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

    // Handle resources/list_changed notifications
    this.client.setNotificationHandler(
      ResourceListChangedNotificationSchema,
      async () => {
        this.logger.info(
          `Server '${this.serverName}': Resource list changed, invalidating cache`,
        );
        this.clearResourceCache();

        // Notify gateway server if callback is provided
        if (this.onResourceListChanged) {
          this.onResourceListChanged(this.serverName);
        }
      },
    );

    // Handle prompts/list_changed notifications
    this.client.setNotificationHandler(
      PromptListChangedNotificationSchema,
      async () => {
        this.logger.info(
          `Server '${this.serverName}': Prompt list changed, invalidating cache`,
        );
        this.clearPromptCache();
      },
    );
  }

  getServerVersion(): Implementation | undefined {
    return this.client.getServerVersion();
  }

  getInstructions(): string | undefined {
    return this.client.getInstructions();
  }

  private clearToolCache(): void {
    this.cachedToolList = undefined;
  }

  private clearResourceCache(): void {
    this.cachedResourceList = undefined;
  }

  private clearPromptCache(): void {
    this.cachedPromptList = undefined;
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

  async listResources() {
    // Return cached response if available
    if (this.cachedResourceList !== undefined) {
      this.logger.debug(
        `Server '${this.serverName}': Returning cached resource list`,
      );
      return this.cachedResourceList;
    }

    // Fetch all pages of resources
    const allResources: ListResourcesResult["resources"] = [];
    let nextCursor: string | undefined = undefined;
    let response: ListResourcesResult;

    do {
      // Fetch current page
      response = await this.client.listResources(
        nextCursor ? { cursor: nextCursor } : undefined,
      );

      // Accumulate resources from this page
      allResources.push(...response.resources);

      // Update cursor for next iteration
      nextCursor = response.nextCursor;
    } while (nextCursor !== undefined);

    // Create final response with all accumulated resources
    const finalResponse: ListResourcesResult = {
      ...response, // Preserves _meta from last response
      resources: allResources,
      nextCursor: undefined, // No cursor since we fetched everything
    };

    // Cache the complete response
    this.cachedResourceList = finalResponse;

    return finalResponse;
  }

  async listPrompts() {
    // Return cached response if available
    if (this.cachedPromptList !== undefined) {
      this.logger.debug(
        `Server '${this.serverName}': Returning cached prompt list`,
      );
      return this.cachedPromptList;
    }

    // Fetch all pages of prompts
    const allPrompts: ListPromptsResult["prompts"] = [];
    let nextCursor: string | undefined = undefined;
    let response: ListPromptsResult;

    do {
      // Fetch current page
      response = await this.client.listPrompts(
        nextCursor ? { cursor: nextCursor } : undefined,
      );

      // Accumulate prompts from this page
      allPrompts.push(...response.prompts);

      // Update cursor for next iteration
      nextCursor = response.nextCursor;
    } while (nextCursor !== undefined);

    // Create final response with all accumulated prompts
    const finalResponse: ListPromptsResult = {
      ...response, // Preserves _meta from last response
      prompts: allPrompts,
      nextCursor: undefined, // No cursor since we fetched everything
    };

    // Cache the complete response
    this.cachedPromptList = finalResponse;

    return finalResponse;
  }

  async readResource(params: { uri: string }) {
    return this.client.readResource(params);
  }

  // Pass through other methods we need
  get experimental() {
    return this.client.experimental;
  }

  async close() {
    return this.client.close();
  }
}
