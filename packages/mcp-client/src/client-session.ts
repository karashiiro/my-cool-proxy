import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getErrorMessage } from "@my-cool-proxy/mcp-utilities";
import type { ILogger, ICacheService } from "./types.js";
import {
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  LoggingMessageNotificationSchema,
  type Implementation,
  type ListResourcesResult,
  type ListResourceTemplatesResult,
  type ResourceTemplate as ResourceTemplateType,
  type ListPromptsResult,
  type Resource,
  type Prompt,
  type Tool,
  type Request,
  type Notification,
  type Result,
  type LoggingMessageNotification,
  type LoggingLevel,
  type CompleteRequest,
  type CompleteResult,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Maps MCP logging levels (RFC 5424 syslog) to pino levels.
 * MCP has 8 levels; pino has 6. We map conservatively.
 */
type PinoLogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const MCP_TO_PINO_LEVEL: Record<LoggingLevel, PinoLogLevel> = {
  debug: "debug",
  info: "info",
  notice: "info", // No pino equivalent, promote to info
  warning: "warn",
  error: "error",
  critical: "error", // Severe but not system-wide
  alert: "fatal", // Requires immediate action
  emergency: "fatal", // System is unusable
};
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
import { createCache } from "./cache-service.js";

export class MCPClientSession {
  private client: Client;
  private allowedTools: string[] | undefined;
  private dangerouslyEnableSampling: boolean;
  private logger: ILogger;
  private serverName: string;
  private toolCache: ICacheService<Tool[]>;
  private resourceCache: ICacheService<Resource[]>;
  private resourceTemplateCache: ICacheService<ResourceTemplateType[]>;
  private promptCache: ICacheService<Prompt[]>;
  private onResourceListChanged?: (serverName: string) => void;
  private onPromptListChanged?: (serverName: string) => void;
  private onToolListChanged?: (serverName: string) => void;
  private onLoggingMessage?: (
    params: LoggingMessageNotification["params"],
  ) => void;

  constructor(
    client: Client,
    serverName: string,
    allowedTools: string[] | undefined,
    logger: ILogger,
    onResourceListChanged?: (serverName: string) => void,
    onPromptListChanged?: (serverName: string) => void,
    onToolListChanged?: (serverName: string) => void,
    dangerouslyEnableSampling?: boolean,
    onLoggingMessage?: (params: LoggingMessageNotification["params"]) => void,
  ) {
    this.client = client;
    this.serverName = serverName;
    this.allowedTools = allowedTools;
    this.dangerouslyEnableSampling = dangerouslyEnableSampling ?? false;
    this.logger = logger;
    this.onResourceListChanged = onResourceListChanged;
    this.onPromptListChanged = onPromptListChanged;
    this.onToolListChanged = onToolListChanged;
    this.onLoggingMessage = onLoggingMessage;

    // Initialize cache instances
    this.toolCache = createCache<Tool[]>(logger);
    this.resourceCache = createCache<Resource[]>(logger);
    this.resourceTemplateCache = createCache<ResourceTemplateType[]>(logger);
    this.promptCache = createCache<Prompt[]>(logger);

    // Register notification handler for tool list changes
    this.setupNotificationHandlers();
  }

  private setupNotificationHandlers(): void {
    // Handle tools/list_changed notifications
    this.client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        try {
          this.logger.info(
            `Server '${this.serverName}': Tool list changed, invalidating cache`,
          );
          this.clearToolCache();

          // Notify gateway server if callback is provided
          if (this.onToolListChanged) {
            this.onToolListChanged(this.serverName);
          }
        } catch (error) {
          this.logger.error(
            `Server '${this.serverName}': Error handling tool list change notification: ${getErrorMessage(error)}`,
          );
        }
      },
    );

    // Handle resources/list_changed notifications
    this.client.setNotificationHandler(
      ResourceListChangedNotificationSchema,
      async () => {
        try {
          this.logger.info(
            `Server '${this.serverName}': Resource list changed, invalidating cache`,
          );
          this.clearResourceCache();
          this.clearResourceTemplateCache();

          // Notify gateway server if callback is provided
          if (this.onResourceListChanged) {
            this.onResourceListChanged(this.serverName);
          }
        } catch (error) {
          this.logger.error(
            `Server '${this.serverName}': Error handling resource list change notification: ${getErrorMessage(error)}`,
          );
        }
      },
    );

    // Handle prompts/list_changed notifications
    this.client.setNotificationHandler(
      PromptListChangedNotificationSchema,
      async () => {
        try {
          this.logger.info(
            `Server '${this.serverName}': Prompt list changed, invalidating cache`,
          );
          this.clearPromptCache();

          // Notify gateway server if callback is provided
          if (this.onPromptListChanged) {
            this.onPromptListChanged(this.serverName);
          }
        } catch (error) {
          this.logger.error(
            `Server '${this.serverName}': Error handling prompt list change notification: ${getErrorMessage(error)}`,
          );
        }
      },
    );

    // Handle notifications/message (logging) notifications
    this.client.setNotificationHandler(
      LoggingMessageNotificationSchema,
      async (notification) => {
        try {
          const { level, logger: loggerName, data } = notification.params;

          // Prefix the logger field with server name for source identification
          const prefixedLogger = loggerName
            ? `[${this.serverName}] ${loggerName}`
            : `[${this.serverName}]`;

          // Log to pino at the appropriate level with structured context
          const pinoLevel = MCP_TO_PINO_LEVEL[level];
          const logContext = {
            mcpServer: this.serverName,
            mcpLogger: loggerName,
            mcpLevel: level,
            data,
          };

          const dataStr = this.formatDataForMessage(data);
          const message = `MCP log from ${this.serverName}: ${dataStr}`;

          // Call the appropriate logger method based on MCP level
          switch (pinoLevel) {
            case "debug":
              this.logger.debug(logContext, message);
              break;
            case "info":
              this.logger.info(logContext, message);
              break;
            case "warn":
              this.logger.warn(logContext, message);
              break;
            case "error":
              this.logger.error(logContext, message);
              break;
            case "fatal":
              this.logger.fatal(logContext, message);
              break;
          }

          // Forward to gateway with prefixed logger, preserving original data
          if (this.onLoggingMessage) {
            this.onLoggingMessage({
              ...notification.params,
              logger: prefixedLogger,
            });
          }
        } catch (error) {
          this.logger.error(
            `Server '${this.serverName}': Error handling logging notification: ${getErrorMessage(error)}`,
          );
        }
      },
    );
  }

  /**
   * Format log data for inclusion in the human-readable log message.
   * Truncates long JSON to keep console output readable while full data
   * is available in the structured context.
   */
  private formatDataForMessage(data: unknown): string {
    if (data === undefined || data === null) return "";
    if (typeof data === "string") return data;
    try {
      const str = JSON.stringify(data);
      return str.length > 200 ? str.slice(0, 200) + "..." : str;
    } catch {
      return "[unserializable data]";
    }
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

  private clearResourceTemplateCache(): void {
    this.resourceTemplateCache.clear();
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
          this.logger.warn(
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

  async listResourceTemplates(): Promise<ResourceTemplateType[]> {
    // Return cached response if available
    const cacheKey = "resourceTemplates"; // Single entry cache
    const cached = this.resourceTemplateCache.get(cacheKey);
    if (cached !== undefined) {
      this.logger.debug(
        `Server '${this.serverName}': Returning cached resource template list`,
      );
      return cached;
    }

    // Fetch all pages of resource templates
    const templates: ResourceTemplateType[] = [];
    let nextCursor: string | undefined = undefined;
    let response: ListResourceTemplatesResult;

    do {
      // Fetch current page
      response = await this.client.listResourceTemplates(
        nextCursor ? { cursor: nextCursor } : undefined,
      );

      // Accumulate templates from this page
      templates.push(...response.resourceTemplates);

      // Update cursor for next iteration
      nextCursor = response.nextCursor;
    } while (nextCursor !== undefined);

    // Cache the complete response
    this.resourceTemplateCache.set("resourceTemplates", templates);

    return templates;
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

  async complete(params: CompleteRequest["params"]): Promise<CompleteResult> {
    return this.client.complete(params);
  }

  /**
   * Call a tool on the connected MCP server.
   * @param params Tool call parameters (name and arguments)
   * @returns The tool call result
   */
  async callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }) {
    return this.client.callTool(params);
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
   * Send a roots/list_changed notification to the upstream server.
   * This notifies the server that the client's root URIs have changed.
   */
  async sendRootsListChanged(): Promise<void> {
    await this.client.sendRootsListChanged();
  }

  /**
   * Get the name of the server this client is connected to.
   */
  getServerName(): string {
    return this.serverName;
  }

  /**
   * Check if sampling is enabled for this server.
   * Returns false by default for safety - servers must explicitly opt-in.
   */
  getDangerouslyEnableSampling(): boolean {
    return this.dangerouslyEnableSampling;
  }
}
