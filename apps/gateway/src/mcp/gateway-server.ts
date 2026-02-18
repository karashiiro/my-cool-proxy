import { injectable, unmanaged } from "inversify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CompleteRequestSchema,
  RootsListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CompleteRequest } from "@modelcontextprotocol/sdk/types.js";
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
  CompletionAggregationService,
} from "@my-cool-proxy/mcp-aggregation";
import type { IToolRegistry } from "../tools/tool-registry.js";
import { getEffectiveSessionId } from "../utils/session.js";

/**
 * Gateway server that aggregates multiple MCP servers and provides unified access.
 *
 * Resource URI Routing Architecture:
 * ==================================
 *
 * Resource URIs pass through the gateway **unchanged** — no namespacing or
 * mutation. Instead, a shared `ResourceRoutingService` maintains per-session
 * routing tables that map original URIs to their source server.
 *
 * Routing tables are populated from three sources:
 *
 * 1. Resource listings (listResources / listResourceTemplates):
 *    - Each URI/template is registered with its source server name
 *    - Invalidated when a server emits `resources/list_changed`
 *
 * 2. Tool results (via Lua runtime):
 *    - resource_link and embedded resource content blocks register their URIs
 *    - Persists across listing invalidation (encounter-based)
 *
 * 3. Prompt results (getPrompt):
 *    - Resource URIs in prompt message content blocks are registered
 *    - Persists across listing invalidation (encounter-based)
 *
 * For inbound requests (readResource, completion/complete with ref/resource),
 * the routing service resolves the original URI to the correct upstream server.
 *
 * Prompt names use a separate `server-name/prompt-name` namespacing scheme
 * (not affected by URI routing — prompt names aren't URIs).
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

  /**
   * Tracks the downstream request ID during tool execution.
   * Used to route server-to-client requests (like roots/list) through the
   * active POST response stream instead of the standalone GET SSE stream,
   * which may be disconnected depending on the client implementation.
   */
  private activeDownstreamRequestId?: string | number;

  constructor(
    @$inject(TYPES.ToolRegistry) private toolRegistry: IToolRegistry,
    @$inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @$inject(TYPES.Logger) private logger: ILogger,
    @$inject(TYPES.ResourceAggregationService)
    private resourceAggregation: ResourceAggregationService,
    @$inject(TYPES.PromptAggregationService)
    private promptAggregation: PromptAggregationService,
    @$inject(TYPES.CompletionAggregationService)
    private completionAggregation: CompletionAggregationService,
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
          // Enable completions so we can forward prompt/resource template completions
          completions: {},
        },
        ...(this.instructions && { instructions: this.instructions }),
      },
    );

    // Register handler for resource list changes from upstream servers.
    // When an upstream server reports its resource list changed:
    // 1. Invalidate caches + routing table
    // 2. Proactively re-list to repopulate routing table
    // 3. Forward the notification downstream (after re-listing, so data is ready)
    this.clientPool.setResourceListChangedHandler(
      (serverName: string, sessionId: string) => {
        this.resourceAggregation.handleResourceListChanged(
          serverName,
          sessionId,
        );

        // Re-list resources and templates to repopulate routing table,
        // then notify downstream clients once fresh data is available.
        Promise.all([
          this.resourceAggregation.listResources(sessionId),
          this.resourceAggregation.listResourceTemplates(sessionId),
        ])
          .then(() => {
            this.sendResourceListChangedSafe(serverName, sessionId);
          })
          .catch((error) => {
            this.logger.error(
              `Failed to re-list resources after list change from '${serverName}' (session: ${sessionId}):`,
              error instanceof Error ? error : new Error(String(error)),
            );
            // Still notify downstream even if re-listing fails —
            // the client may be able to recover by listing itself
            this.sendResourceListChangedSafe(serverName, sessionId);
          });
      },
    );

    // Register handler for prompt list changes from upstream servers.
    // Same pattern as resources: invalidate, re-list, then forward notification.
    this.clientPool.setPromptListChangedHandler(
      (serverName: string, sessionId: string) => {
        this.promptAggregation.handlePromptListChanged(serverName, sessionId);

        // Re-list prompts to repopulate cache,
        // then notify downstream clients once fresh data is available.
        this.promptAggregation
          .listPrompts(sessionId)
          .then(() => {
            this.sendPromptListChangedSafe(serverName, sessionId);
          })
          .catch((error) => {
            this.logger.error(
              `Failed to re-list prompts after list change from '${serverName}' (session: ${sessionId}):`,
              error instanceof Error ? error : new Error(String(error)),
            );
            // Still notify downstream even if re-listing fails
            this.sendPromptListChangedSafe(serverName, sessionId);
          });
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

  /**
   * Send resources/list_changed notification to downstream, catching errors
   * (e.g. if the client disconnected) so the fire-and-forget promise chain
   * never produces an unhandled rejection.
   */
  private sendResourceListChangedSafe(
    serverName: string,
    sessionId: string,
  ): void {
    try {
      this.server.sendResourceListChanged();
    } catch (error) {
      this.logger.warn(
        `Failed to send resources/list_changed downstream after change from '${serverName}' (session: ${sessionId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Send prompts/list_changed notification to downstream, catching errors.
   */
  private sendPromptListChangedSafe(
    serverName: string,
    sessionId: string,
  ): void {
    try {
      this.server.sendPromptListChanged();
    } catch (error) {
      this.logger.warn(
        `Failed to send prompts/list_changed downstream after change from '${serverName}' (session: ${sessionId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
          // The SDK passes the full RequestHandlerExtra here, which includes
          // requestId — we capture it so forwardListRootsRequest can route
          // through the POST response stream rather than the standalone GET SSE.
          context: { sessionId?: string; requestId?: string | number },
        ) => {
          this.activeDownstreamRequestId = context.requestId;
          try {
            return await tool.execute(args, context);
          } finally {
            this.activeDownstreamRequestId = undefined;
          }
        },
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

    this.server.server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async (_request: unknown, { sessionId }: { sessionId?: string }) =>
        this.resourceAggregation.listResourceTemplates(
          getEffectiveSessionId(sessionId),
        ),
    );

    this.server.server.setRequestHandler(
      CompleteRequestSchema,
      async (
        request: { params: CompleteRequest["params"] },
        { sessionId }: { sessionId?: string },
      ) =>
        this.completionAggregation.complete(
          request.params,
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
      // Pass relatedRequestId so the transport routes through the active POST
      // response stream. Without this, the request goes to the standalone GET
      // SSE stream which may be disconnected (e.g. Claude Code doesn't maintain one).
      const options =
        this.activeDownstreamRequestId !== undefined
          ? { relatedRequestId: this.activeDownstreamRequestId }
          : undefined;
      const result = await this.server.server.listRoots(undefined, options);
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
