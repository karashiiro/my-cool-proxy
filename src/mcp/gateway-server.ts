import { injectable, inject } from "inversify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolResultSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type {
  ILuaRuntime,
  IMCPClientManager,
  ILogger,
} from "../types/interfaces.js";
import { TYPES } from "../types/index.js";
import { ToolDiscoveryService } from "./tool-discovery-service.js";
import { ResourceAggregationService } from "./resource-aggregation-service.js";
import { PromptAggregationService } from "./prompt-aggregation-service.js";
import { MCPFormatterService } from "./mcp-formatter-service.js";

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
    @inject(TYPES.LuaRuntime) private luaRuntime: ILuaRuntime,
    @inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.ToolDiscoveryService)
    private toolDiscovery: ToolDiscoveryService,
    @inject(TYPES.ResourceAggregationService)
    private resourceAggregation: ResourceAggregationService,
    @inject(TYPES.PromptAggregationService)
    private promptAggregation: PromptAggregationService,
    @inject(TYPES.MCPFormatterService) private formatter: MCPFormatterService,
  ) {
    this.server = new McpServer(
      {
        name: this.serverId,
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
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
    // Tool to execute Lua scripts with access to MCP servers
    this.server.registerTool(
      "execute",
      {
        description: `Execute a Lua script that can call tools on available MCP servers.
MCP servers are available as globals with their Lua identifiers.

Use list-servers to see available servers, list-server-tools to see the tools on a particular
server, and tool-details to get full information for a single tool. You MUST use tool-details
at least once for each tool you want to call to understand its inputs and outputs.

Wherever possible, combine multiple tool calls into a single script to avoid returning unnecessary data.

To return a value, call the global result() function with the value as an argument.
Tool calls return promises - use :await() to get the result.
Example: result(server_name.tool_name({ arg = "value" }):await())`,
        inputSchema: {
          script: z
            .string()
            .describe(
              "Lua script to execute. Available servers are accessible as global variables. " +
                "Tool calls return promises, so use :await() to unwrap them. " +
                "Call the global result() function to return a value from the script.",
            ),
        },
      },
      async ({ script }, { sessionId }): Promise<CallToolResult> => {
        const mcpServers = this.clientPool.getClientsBySession(
          sessionId || "default",
        );
        try {
          const result = await this.luaRuntime.executeScript(
            script,
            mcpServers,
          );

          if (
            result &&
            typeof result === "object" &&
            "content" in result &&
            Array.isArray((result as Record<string, unknown>).content)
          ) {
            const parseResult = CallToolResultSchema.safeParse(result);
            if (parseResult.success) return parseResult.data;
          }

          if (result !== null && typeof result === "object") {
            return {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
              structuredContent: result as Record<string, unknown>,
            };
          }

          return {
            content: [
              {
                type: "text",
                text:
                  result !== undefined
                    ? `Script executed successfully.\n\nResult:\n${result}`
                    : "Script executed successfully. No result returned.",
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `Script execution failed:\n${error}` },
            ],
            isError: true,
          };
        }
      },
    );

    // Tool to list available MCP servers and their info
    this.server.registerTool(
      "list-servers",
      {
        description:
          "List all available MCP servers for this session, including their Lua identifiers and server information",
        inputSchema: {},
      },
      async (_, { sessionId }) =>
        this.toolDiscovery.listServers(sessionId || "default"),
    );

    // Tool to list tools for a specific MCP server
    this.server.registerTool(
      "list-server-tools",
      {
        description:
          "List all available tools for a specific MCP server using its Lua identifier",
        inputSchema: {
          luaServerName: z
            .string()
            .describe("The Lua identifier of the MCP server to list tools for"),
        },
      },
      async ({ luaServerName }, { sessionId }) =>
        this.toolDiscovery.listServerTools(
          luaServerName,
          sessionId || "default",
        ),
    );

    // Tool to get detailed info about a specific tool
    this.server.registerTool(
      "tool-details",
      {
        description:
          "Get detailed information about a specific tool including full description and schemas",
        inputSchema: {
          luaServerName: z
            .string()
            .describe("The Lua identifier of the MCP server"),
          luaToolName: z.string().describe("The Lua identifier of the tool"),
        },
      },
      async ({ luaServerName, luaToolName }, { sessionId }) =>
        this.toolDiscovery.getToolDetails(
          luaServerName,
          luaToolName,
          sessionId || "default",
        ),
    );

    this.logger.info("MCP gateway tools registered");

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
