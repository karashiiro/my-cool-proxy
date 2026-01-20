import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ILogger, ICacheService } from "../types/interfaces.js";
import {
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  type Implementation,
  type ListResourcesResult,
  type ListPromptsResult,
  type Resource,
  type Prompt,
  type Tool,
  type Request,
  type Notification,
  type Result,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  AnyObjectSchema,
  SchemaOutput,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type {
  ClientRequest,
  ClientNotification,
  ClientResult,
} from "@modelcontextprotocol/sdk/types.js";
import { createCache } from "../services/cache-service.js";

export class MCPClientSession {
  private client: Client;
  private allowedTools: string[] | undefined;
  private logger: ILogger;
  private serverName: string;
  private toolCache: ICacheService<Tool[]>;
  private resourceCache: ICacheService<Resource[]>;
  private promptCache: ICacheService<Prompt[]>;
  private onResourceListChanged?: (serverName: string) => void;
  private onPromptListChanged?: (serverName: string) => void;

  constructor(
    client: Client,
    serverName: string,
    allowedTools: string[] | undefined,
    logger: ILogger,
    onResourceListChanged?: (serverName: string) => void,
    onPromptListChanged?: (serverName: string) => void,
  ) {
    this.client = client;
    this.serverName = serverName;
    this.allowedTools = allowedTools;
    this.logger = logger;
    this.onResourceListChanged = onResourceListChanged;
    this.onPromptListChanged = onPromptListChanged;

    // Initialize cache instances
    this.toolCache = createCache<Tool[]>(logger);
    this.resourceCache = createCache<Resource[]>(logger);
    this.promptCache = createCache<Prompt[]>(logger);

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

        // Notify gateway server if callback is provided
        if (this.onPromptListChanged) {
          this.onPromptListChanged(this.serverName);
        }
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
    this.toolCache.clear();
  }

  private clearResourceCache(): void {
    this.resourceCache.clear();
  }

  private clearPromptCache(): void {
    this.promptCache.clear();
  }

  // Wrap listTools to filter results
  async listTools() {
    // Return cached response if available
    const cacheKey = "tools"; // Single entry cache
    const cached = this.toolCache.get(cacheKey);
    if (cached !== undefined) {
      this.logger.debug(
        `Server '${this.serverName}': Returning cached tool list`,
      );
      return cached;
    }

    // Fetch fresh tool list from server
    const response = await this.client.listTools();
    let tools = response.tools;

    // If no filter, return all tools
    // If empty array, return no tools
    if (this.allowedTools && this.allowedTools.length === 0) {
      this.logger.info(
        `Server '${this.serverName}': All tools blocked by empty allowedTools array`,
      );
      tools = [];
    } else if (this.allowedTools) {
      // Filter to only allowed tools
      const allowedSet = new Set(this.allowedTools);
      const filteredTools = tools.filter((tool) => allowedSet.has(tool.name));

      // Log warnings for tools in allowedTools that don't exist
      const actualToolNames = new Set(tools.map((t) => t.name));
      for (const allowedTool of this.allowedTools) {
        if (!actualToolNames.has(allowedTool)) {
          this.logger.error(
            `Server '${this.serverName}': Tool '${allowedTool}' in allowedTools not found. Available: ${Array.from(actualToolNames).join(", ")}`,
          );
        }
      }

      this.logger.info(
        `Server '${this.serverName}': Filtered to ${filteredTools.length} of ${tools.length} tools: ${filteredTools.map((t) => t.name).join(", ")}`,
      );

      tools = filteredTools;
    }

    // Cache the filtered response
    this.toolCache.set("tools", tools);

    return tools;
  }

  async listResources(): Promise<Resource[]> {
    // Return cached response if available
    const cacheKey = "resources"; // Single entry cache
    const cached = this.resourceCache.get(cacheKey);
    if (cached !== undefined) {
      this.logger.debug(
        `Server '${this.serverName}': Returning cached resource list`,
      );
      return cached;
    }

    // Fetch all pages of resources
    const resources: Resource[] = [];
    let nextCursor: string | undefined = undefined;
    let response: ListResourcesResult;

    do {
      // Fetch current page
      response = await this.client.listResources(
        nextCursor ? { cursor: nextCursor } : undefined,
      );

      // Accumulate resources from this page
      resources.push(...response.resources);

      // Update cursor for next iteration
      nextCursor = response.nextCursor;
    } while (nextCursor !== undefined);

    // Cache the complete response
    this.resourceCache.set("resources", resources);

    return resources;
  }

  async listPrompts() {
    // Return cached response if available
    const cacheKey = "prompts"; // Single entry cache
    const cached = this.promptCache.get(cacheKey);
    if (cached !== undefined) {
      this.logger.debug(
        `Server '${this.serverName}': Returning cached prompt list`,
      );
      return cached;
    }

    // Fetch all pages of prompts
    const prompts: Prompt[] = [];
    let nextCursor: string | undefined = undefined;
    let response: ListPromptsResult;

    do {
      // Fetch current page
      response = await this.client.listPrompts(
        nextCursor ? { cursor: nextCursor } : undefined,
      );

      // Accumulate prompts from this page
      prompts.push(...response.prompts);

      // Update cursor for next iteration
      nextCursor = response.nextCursor;
    } while (nextCursor !== undefined);

    // Cache the complete response
    this.promptCache.set("prompts", prompts);

    return prompts;
  }

  async readResource(params: { uri: string }) {
    return this.client.readResource(params);
  }

  async getPrompt(params: {
    name: string;
    arguments?: Record<string, string>;
  }) {
    return this.client.getPrompt(params);
  }

  // Pass through other methods we need
  get experimental() {
    return this.client.experimental;
  }

  async close() {
    return this.client.close();
  }

  /**
   * Register a request handler on the underlying SDK client.
   * This is used to handle incoming requests from the connected MCP server
   * (e.g., sampling/createMessage, elicitation/create).
   *
   * @param requestSchema The Zod schema for the request type to handle
   * @param handler The handler function to process incoming requests
   */
  setRequestHandler<T extends AnyObjectSchema>(
    requestSchema: T,
    handler: (
      request: SchemaOutput<T>,
      extra: RequestHandlerExtra<
        ClientRequest | Request,
        ClientNotification | Notification
      >,
    ) => ClientResult | Result | Promise<ClientResult | Result>,
  ): void {
    this.client.setRequestHandler(requestSchema, handler);
  }

  /**
   * Get the name of the server this client is connected to.
   */
  getServerName(): string {
    return this.serverName;
  }
}
