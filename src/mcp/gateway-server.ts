import { injectable, inject } from "inversify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { IMCPClientManager, ILogger } from "../types/interfaces.js";
import { TYPES } from "../types/index.js";
import { ResourceAggregationService } from "./resource-aggregation-service.js";
import { PromptAggregationService } from "./prompt-aggregation-service.js";
import type { IToolRegistry } from "../tools/tool-registry.js";

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
 *    - listResources(): Namespaces URIs here (e.g., file:/// → mcp://server-name/file:///)
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
@injectable()
export class MCPGatewayServer {
  private server: McpServer;
  private serverId = "my-cool-proxy";

  constructor(
    @inject(TYPES.ToolRegistry) private toolRegistry: IToolRegistry,
    @inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.ResourceAggregationService)
    private resourceAggregation: ResourceAggregationService,
    @inject(TYPES.PromptAggregationService)
    private promptAggregation: PromptAggregationService,
  ) {
    this.server = new McpServer(
      {
        name: this.serverId,
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {
            listChanged: true,
          },
          resources: {
            listChanged: true,
          },
          prompts: {
            listChanged: true,
          },
        },
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
        this.resourceAggregation.listResources(sessionId || "default"),
    );

    this.server.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (
        request: { params: { uri: string } },
        { sessionId }: { sessionId?: string },
      ) =>
        this.resourceAggregation.readResource(
          request.params.uri,
          sessionId || "default",
        ),
    );

    this.server.server.setRequestHandler(
      ListPromptsRequestSchema,
      async (_request: unknown, { sessionId }: { sessionId?: string }) =>
        this.promptAggregation.listPrompts(sessionId || "default"),
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
          sessionId || "default",
        ),
    );
  }

  // handlers registered above via delegation

  getServer(): McpServer {
    return this.server;
  }
}
