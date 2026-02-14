import { injectable, unmanaged } from "inversify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  RootsListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  CreateMessageRequest,
  CreateMessageResult,
  CreateMessageResultWithTools,
  ElicitRequest,
  ElicitResult,
  ListRootsResult,
  LoggingMessageNotification,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  IMCPClientManager,
  ILogger,
  ClientCapabilities,
} from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import {
  ResourceAggregationService,
  PromptAggregationService,
} from "@my-cool-proxy/mcp-aggregation";
import type { IToolRegistry } from "../tools/tool-registry.js";
import { getEffectiveSessionId } from "../utils/session.js";

/**
 * Gateway server that aggregates multiple MCP servers and provides namespaced access.
 *
 * Resource/Prompt URI Namespacing Architecture:
 * ============================================
 *
 * This gateway handles transformation between namespaced (client-facing) and
 * un-namespaced (server-facing) URIs in different places:
 *
 * 1. Resources/Prompts → Client (Outbound):
 *    - listResources(): Namespaces URIs here (e.g., file:/// → gw://server-name/file:///)
 *    - listPrompts(): Namespaces names here (e.g., prompt → server-name/prompt)
 *
 * 2. Client → Resources/Prompts (Inbound):
 *    - readResource(): Parses namespaced URI and routes to correct server
 *    - getPrompt(): Parses namespaced name and routes to correct server
 *
 * 3. Tool Results → Client (Outbound, via Lua):
 *    - Resource URIs in CallToolResult content blocks are namespaced in the
 *      Lua runtime (NOT here!) because the runtime has the per-tool-call server
 *      context. See WasmoonRuntime.injectMCPServers() for details.
 *
 * 4. Prompt Messages → Client (Outbound):
 *    - getPrompt(): Namespaces resource URIs in prompt message content blocks
 *      before returning to the client. Prompts can include resource_link or
 *      embedded resource content blocks.
 *
 * This separation ensures we always have the necessary context to namespace
 * correctly, even when Lua scripts call tools from multiple servers.
 */
/**
 * Callback type for when a downstream client completes initialization.
 * Receives the client's capabilities so upstream connections can be configured accordingly.
 */
export type OnDownstreamInitializedCallback = (
  capabilities: ClientCapabilities,
) => void | Promise<void>;

@injectable()
export class MCPGatewayServer {
  private server: McpServer;
  private serverId = "my-cool-proxy";
  private onDownstreamInitialized?: OnDownstreamInitializedCallback;

  constructor(
    @$inject(TYPES.ToolRegistry) private toolRegistry: IToolRegistry,
    @$inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @$inject(TYPES.Logger) private logger: ILogger,
    @$inject(TYPES.ResourceAggregationService)
    private resourceAggregation: ResourceAggregationService,
    @$inject(TYPES.PromptAggregationService)
    private promptAggregation: PromptAggregationService,
    @unmanaged() private instructions?: string,
  ) {
    this.server = new McpServer(
      {
        name: this.serverId,
        version: "1.0.0",
      },
      {
        capabilities: {
          // We don't need listChanged here because our own exposed tools never change, even
          // if those of the underlying servers do.
          tools: {},
          resources: {
            listChanged: true,
          },
          prompts: {
            listChanged: true,
          },
          // Enable logging so we can forward log messages from upstream servers
          logging: {},
        },
        ...(this.instructions && { instructions: this.instructions }),
      },
    );

    // Register handler for resource list changes from clients
    this.clientPool.setResourceListChangedHandler(
      (serverName: string, sessionId: string) => {
        this.resourceAggregation.handleResourceListChanged(
          serverName,
          sessionId,
        );
        this.server.sendResourceListChanged();
      },
    );

    // Register handler for prompt list changes from clients
    this.clientPool.setPromptListChangedHandler(
      (serverName: string, sessionId: string) => {
        this.promptAggregation.handlePromptListChanged(serverName, sessionId);
        this.server.sendPromptListChanged();
      },
    );

    // Register handler for tool list changes from clients
    // Note: We don't send tools/list_changed downstream because the gateway's own
    // tools never change. This handler is for logging/observability only.
    // The tool cache in MCPClientSession is automatically invalidated, so subsequent
    // calls to list-server-tools will return fresh data.
    this.clientPool.setToolListChangedHandler(
      (serverName: string, sessionId: string) => {
        this.logger.info(
          `Upstream server '${serverName}' reported tool list changed (session: ${sessionId})`,
        );
      },
    );

    // Register handler for logging notifications from clients
    // Forward log messages from upstream servers to downstream clients
    this.clientPool.setLoggingMessageHandler(
      (params: LoggingMessageNotification["params"], sessionId: string) => {
        this.logger.debug(
          `Forwarding log from upstream (level=${params.level}, logger=${params.logger}) to session ${sessionId}`,
        );
        this.server.sendLoggingMessage(params, sessionId);
      },
    );

    this.setupTools();
  }

  private setupTools(): void {
    // Register all tools from the tool registry
    for (const tool of this.toolRegistry.getAll()) {
      this.server.registerTool(
        tool.name,
        {
          description: tool.description,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          inputSchema: tool.schema as any,
          annotations: tool.annotations,
        },
        async (
          args: Record<string, unknown>,
          context: { sessionId?: string },
        ) => tool.execute(args, context),
      );

      this.logger.info(`Registered tool: ${tool.name}`);
    }

    this.logger.info(
      `MCP gateway tools registered (${this.toolRegistry.getAll().length} tools)`,
    );

    // Register resource and prompt handlers that delegate to aggregation services
    this.server.server.setRequestHandler(
      ListResourcesRequestSchema,
      async (_request: unknown, { sessionId }: { sessionId?: string }) =>
        this.resourceAggregation.listResources(
          getEffectiveSessionId(sessionId),
        ),
    );

    this.server.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (
        request: { params: { uri: string } },
        { sessionId }: { sessionId?: string },
      ) =>
        this.resourceAggregation.readResource(
          request.params.uri,
          getEffectiveSessionId(sessionId),
        ),
    );

    this.server.server.setRequestHandler(
      ListPromptsRequestSchema,
      async (_request: unknown, { sessionId }: { sessionId?: string }) =>
        this.promptAggregation.listPrompts(getEffectiveSessionId(sessionId)),
    );

    this.server.server.setRequestHandler(
      GetPromptRequestSchema,
      async (
        request: {
          params: { name: string; arguments?: Record<string, string> };
        },
        { sessionId }: { sessionId?: string },
      ) =>
        this.promptAggregation.getPrompt(
          request.params.name,
          request.params.arguments,
          getEffectiveSessionId(sessionId),
        ),
    );
  }

  // handlers registered above via delegation

  /**
   * Set a callback to be invoked when the downstream client completes initialization.
   * This allows the caller to capture client capabilities and configure upstream
   * connections accordingly.
   *
   * @param callback Function to call with downstream client capabilities
   */
  setOnDownstreamInitialized(callback: OnDownstreamInitializedCallback): void {
    this.onDownstreamInitialized = callback;

    // Hook into the underlying server's initialization completion
    this.server.server.oninitialized = async () => {
      const clientCaps = this.server.server.getClientCapabilities();

      // Forward all client capabilities to upstream servers
      const downstreamCaps: ClientCapabilities = clientCaps || {};

      this.logger.debug(
        `Downstream client initialized with capabilities: sampling=${!!downstreamCaps.sampling}, elicitation=${!!downstreamCaps.elicitation}, roots=${!!downstreamCaps.roots}`,
      );

      // Call the callback and await it to ensure proper initialization order
      await this.onDownstreamInitialized?.(downstreamCaps);
    };
  }

  /**
   * Get the downstream client's capabilities after initialization.
   * Returns undefined if the client hasn't initialized yet.
   */
  getClientCapabilities(): ClientCapabilities | undefined {
    const clientCaps = this.server.server.getClientCapabilities();
    if (!clientCaps) return undefined;

    // Return all client capabilities
    return clientCaps;
  }

  getServer(): McpServer {
    return this.server;
  }

  /**
   * Forward a sampling request from an upstream server to the downstream client.
   * This is called when an upstream MCP server sends a sampling/createMessage request.
   *
   * @param params The sampling request parameters from the upstream server
   * @returns The result from the downstream client
   */
  async forwardSamplingRequest(
    params: CreateMessageRequest["params"],
  ): Promise<CreateMessageResult | CreateMessageResultWithTools> {
    this.logger.debug(
      `Forwarding sampling request to downstream: ${params.messages.length} message(s), maxTokens=${params.maxTokens}`,
    );

    try {
      const result = await this.server.server.createMessage(params);
      this.logger.debug(`Sampling request completed successfully`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to forward sampling request to downstream`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Forward an elicitation request from an upstream server to the downstream client.
   * This is called when an upstream MCP server sends an elicitation/create request.
   *
   * @param params The elicitation request parameters from the upstream server
   * @returns The result from the downstream client
   */
  async forwardElicitationRequest(
    params: ElicitRequest["params"],
  ): Promise<ElicitResult> {
    const mode = "mode" in params ? params.mode : "form";
    this.logger.debug(
      `Forwarding elicitation request to downstream: mode=${mode}, message="${params.message.substring(0, 50)}..."`,
    );

    try {
      const result = await this.server.server.elicitInput(params);
      this.logger.debug(
        `Elicitation request completed: action=${result.action}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to forward elicitation request to downstream`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Forward a roots/list request from an upstream server to the downstream client.
   * This is called when an upstream MCP server sends a roots/list request.
   *
   * @returns The list of roots from the downstream client
   */
  async forwardListRootsRequest(): Promise<ListRootsResult> {
    this.logger.debug(`Forwarding roots/list request to downstream`);

    try {
      const result = await this.server.server.listRoots();
      this.logger.debug(
        `Roots/list request completed: ${result.roots.length} root(s)`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to forward roots/list request to downstream`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Register a handler that forwards roots/list_changed notifications from the
   * downstream client to all upstream servers in the given session.
   *
   * @param sessionId The session ID to look up upstream clients for
   */
  registerRootsNotificationForwarding(sessionId: string): void {
    this.server.server.setNotificationHandler(
      RootsListChangedNotificationSchema,
      async () => {
        this.logger.debug(
          `Received roots/list_changed from downstream, forwarding to upstream clients (session: ${sessionId})`,
        );

        const clients = this.clientPool.getClientsBySession(sessionId);
        for (const [serverName, clientSession] of clients) {
          try {
            await clientSession.sendRootsListChanged();
            this.logger.debug(
              `Sent roots/list_changed to upstream server '${serverName}'`,
            );
          } catch (error) {
            this.logger.warn(
              `Failed to send roots/list_changed to upstream server '${serverName}': ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      },
    );

    this.logger.debug(
      `Registered roots/list_changed notification forwarding for session ${sessionId}`,
    );
  }
}
