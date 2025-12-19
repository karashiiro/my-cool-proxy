import { injectable, inject } from "inversify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ListResourcesResult,
  ReadResourceResult,
  Resource,
  ListPromptsResult,
  GetPromptResult,
  Prompt,
} from "@modelcontextprotocol/sdk/types.js";
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
import { sanitizeLuaIdentifier } from "../utils/lua-identifier.js";
import { formatSchema } from "../utils/schema-formatter.js";
import { namespaceResource, parseResourceUri } from "../utils/resource-uri.js";
import { namespacePrompt, parsePromptName } from "../utils/prompt-name.js";
import type { MCPClientSession } from "./client-session.js";

interface ServerInfo {
  luaIdentifier: string;
  serverInfo: {
    name?: string;
    description?: string;
    version?: string;
    instructions?: string;
  };
}

interface ServerError {
  luaIdentifier: string;
  error: string;
}

type ServerListItem = ServerInfo | ServerError;

interface ToolInfo {
  luaName: string;
  description: string;
}

@injectable()
export class MCPGatewayServer {
  private server: McpServer;
  private resourceCache = new Map<
    string,
    { resources: Resource[]; timestamp: number }
  >();
  private promptCache = new Map<
    string,
    { prompts: Prompt[]; timestamp: number }
  >();

  constructor(
    @inject(TYPES.LuaRuntime) private luaRuntime: ILuaRuntime,
    @inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @inject(TYPES.Logger) private logger: ILogger,
  ) {
    this.server = new McpServer(
      {
        name: "my-cool-proxy",
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
        this.handleResourceListChanged(serverName, sessionId);
      },
    );

    // Register handler for prompt list changes from clients
    this.clientPool.setPromptListChangedHandler(
      (serverName: string, sessionId: string) => {
        this.handlePromptListChanged(serverName, sessionId);
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

To return a value, assign it to the 'result' global variable (WITHOUT 'local' keyword).
Tool calls return promises - use :await() to get the result.
Example: result = server_name.tool_name({ arg = "value" }):await()`,
        inputSchema: {
          script: z
            .string()
            .describe(
              "Lua script to execute. Available servers are accessible as global variables. " +
                "Tool calls return promises, so use :await() to unwrap them. " +
                "Set 'result' variable to return a value from the script (do NOT use 'local result').",
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

          // Check if result is already a valid CallToolResult
          // Only attempt to parse as CallToolResult if it explicitly has a content array
          if (
            result &&
            typeof result === "object" &&
            "content" in result &&
            Array.isArray((result as Record<string, unknown>).content)
          ) {
            const parseResult = CallToolResultSchema.safeParse(result);
            if (parseResult.success) {
              // Return the CallToolResult directly to preserve rich content (images, audio, etc.)
              return parseResult.data;
            }
          }

          // If result is an object, return it as structuredContent (with JSON in text for backwards compatibility)
          if (result !== null && typeof result === "object") {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
              structuredContent: result as Record<string, unknown>,
            };
          }

          // Otherwise, wrap the result in a text content block
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
              {
                type: "text",
                text: `Script execution failed:\n${error}`,
              },
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
      async (_, { sessionId }): Promise<CallToolResult> => {
        try {
          const mcpServers = this.clientPool.getClientsBySession(
            sessionId || "default",
          );
          const serverList = this.gatherServerInfo(mcpServers);
          const formattedOutput = this.formatServerList(
            sessionId || "default",
            serverList,
          );

          return {
            content: [{ type: "text", text: formattedOutput }],
          };
        } catch (error) {
          return {
            content: [
              { type: "text", text: `Failed to list servers: ${error}` },
            ],
            isError: true,
          };
        }
      },
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
      async ({ luaServerName }, { sessionId }): Promise<CallToolResult> => {
        try {
          const mcpServers = this.clientPool.getClientsBySession(
            sessionId || "default",
          );
          const client = this.findClientByLuaName(mcpServers, luaServerName);

          if (!client) {
            const availableServers = Array.from(mcpServers.keys()).map((name) =>
              sanitizeLuaIdentifier(name),
            );
            const serverList =
              availableServers.length > 0
                ? availableServers.join(", ")
                : "none";
            return {
              content: [
                {
                  type: "text",
                  text: `Server '${luaServerName}' not found in session '${sessionId || "default"}'.\n\nAvailable servers: ${serverList}`,
                },
              ],
              isError: true,
            };
          }

          const tools = await this.gatherToolInfo(client);
          const formattedOutput = this.formatToolList(luaServerName, tools);

          return {
            content: [{ type: "text", text: formattedOutput }],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to list tools for server '${luaServerName}': ${error}`,
              },
            ],
            isError: true,
          };
        }
      },
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
      async (
        { luaServerName, luaToolName },
        { sessionId },
      ): Promise<CallToolResult> => {
        try {
          const mcpServers = this.clientPool.getClientsBySession(
            sessionId || "default",
          );
          const client = this.findClientByLuaName(mcpServers, luaServerName);

          if (!client) {
            const availableServers = Array.from(mcpServers.keys()).map((name) =>
              sanitizeLuaIdentifier(name),
            );
            const serverList =
              availableServers.length > 0
                ? availableServers.join(", ")
                : "none";
            return {
              content: [
                {
                  type: "text",
                  text: `Server '${luaServerName}' not found.\n\nAvailable servers: ${serverList}`,
                },
              ],
              isError: true,
            };
          }

          const toolsResponse = await client.listTools();
          const tool = toolsResponse.tools.find(
            (t) => sanitizeLuaIdentifier(t.name) === luaToolName,
          );

          if (!tool) {
            const availableTools = toolsResponse.tools.map((t) =>
              sanitizeLuaIdentifier(t.name),
            );
            const toolList =
              availableTools.length > 0 ? availableTools.join(", ") : "none";
            return {
              content: [
                {
                  type: "text",
                  text: `Tool '${luaToolName}' not found on server '${luaServerName}'.\n\nAvailable tools: ${toolList}`,
                },
              ],
              isError: true,
            };
          }

          const formattedOutput = this.formatToolDetails(
            luaServerName,
            luaToolName,
            tool,
          );

          return {
            content: [{ type: "text", text: formattedOutput }],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get tool details: ${error}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    this.logger.info("MCP gateway tools registered");

    // Register resource handlers
    this.setupResourceHandlers();

    // Register prompt handlers
    this.setupPromptHandlers();
  }

  private setupResourceHandlers(): void {
    // Handler for listing resources from all connected MCP servers
    this.server.server.setRequestHandler(
      ListResourcesRequestSchema,
      async (
        _request: unknown,
        { sessionId }: { sessionId?: string },
      ): Promise<ListResourcesResult> => {
        const session = sessionId || "default";

        // Check cache first
        const cached = this.resourceCache.get(session);
        if (cached) {
          this.logger.debug(
            `Returning cached resource list for session '${session}'`,
          );
          return {
            resources: cached.resources,
          };
        }

        // Get all clients for this session
        const clients = this.clientPool.getClientsBySession(session);

        if (clients.size === 0) {
          this.logger.info(`No clients available for session '${session}'`);
          return { resources: [] };
        }

        // Fetch resources from all clients in parallel
        const resourcePromises = Array.from(clients.entries()).map(
          async ([name, client]) => {
            try {
              const result = await client.listResources();
              return { name, resources: result.resources };
            } catch (error) {
              this.logger.error(
                `Failed to list resources from server '${name}':`,
                error as Error,
              );
              return { name, resources: [] };
            }
          },
        );

        const results = await Promise.all(resourcePromises);

        // Aggregate and namespace all resources
        const allResources: Resource[] = [];
        for (const { name, resources } of results) {
          for (const resource of resources) {
            allResources.push(namespaceResource(name, resource));
          }
        }

        // Cache the aggregated result
        this.resourceCache.set(session, {
          resources: allResources,
          timestamp: Date.now(),
        });

        this.logger.info(
          `Aggregated ${allResources.length} resources from ${clients.size} servers for session '${session}'`,
        );

        return {
          resources: allResources,
        };
      },
    );

    // Handler for reading a specific resource
    this.server.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (
        request: { params: { uri: string } },
        { sessionId }: { sessionId?: string },
      ): Promise<ReadResourceResult> => {
        const session = sessionId || "default";
        const { uri } = request.params;

        // Parse the namespaced URI
        const parsed = parseResourceUri(uri);
        if (!parsed) {
          throw new Error(
            `Invalid resource URI format: '${uri}'. Expected format: mcp://{server-name}/{uri}`,
          );
        }

        const { serverName, originalUri } = parsed;

        // Get all clients for this session
        const clients = this.clientPool.getClientsBySession(session);

        // Find the client matching the server name
        const client = clients.get(serverName);
        if (!client) {
          const availableServers = Array.from(clients.keys()).join(", ");
          throw new Error(
            `Server '${serverName}' not found in session '${session}'. Available servers: ${availableServers || "none"}`,
          );
        }

        // Read the resource from the client
        try {
          const result = await client.readResource({ uri: originalUri });
          this.logger.debug(
            `Read resource '${originalUri}' from server '${serverName}'`,
          );
          return result;
        } catch (error) {
          this.logger.error(
            `Failed to read resource '${originalUri}' from server '${serverName}':`,
            error as Error,
          );
          throw error;
        }
      },
    );

    this.logger.info("MCP gateway resource handlers registered");
  }

  private handleResourceListChanged(
    serverName: string,
    sessionId: string,
  ): void {
    this.logger.info(
      `Resource list changed for server '${serverName}' in session '${sessionId}'`,
    );

    // Clear aggregated cache for this session
    this.resourceCache.delete(sessionId);

    // Notify our own clients that the resource list has changed
    this.server.sendResourceListChanged();
  }

  private handlePromptListChanged(serverName: string, sessionId: string): void {
    this.logger.info(
      `Prompt list changed for server '${serverName}' in session '${sessionId}'`,
    );

    // Clear aggregated cache for this session
    this.promptCache.delete(sessionId);

    // Notify our own clients that the prompt list has changed
    this.server.sendPromptListChanged();
  }

  private setupPromptHandlers(): void {
    // Handler for listing prompts from all connected MCP servers
    this.server.server.setRequestHandler(
      ListPromptsRequestSchema,
      async (
        _request: unknown,
        { sessionId }: { sessionId?: string },
      ): Promise<ListPromptsResult> => {
        const session = sessionId || "default";

        // Check cache first
        const cached = this.promptCache.get(session);
        if (cached) {
          this.logger.debug(
            `Returning cached prompt list for session '${session}'`,
          );
          return {
            prompts: cached.prompts,
          };
        }

        // Get all clients for this session
        const clients = this.clientPool.getClientsBySession(session);

        if (clients.size === 0) {
          this.logger.info(`No clients available for session '${session}'`);
          return { prompts: [] };
        }

        // Fetch prompts from all clients in parallel
        const promptPromises = Array.from(clients.entries()).map(
          async ([name, client]) => {
            try {
              const result = await client.listPrompts();
              return { name, prompts: result.prompts };
            } catch (error) {
              this.logger.error(
                `Failed to list prompts from server '${name}':`,
                error as Error,
              );
              return { name, prompts: [] };
            }
          },
        );

        const results = await Promise.all(promptPromises);

        // Aggregate and namespace all prompts
        const allPrompts: Prompt[] = [];
        for (const { name, prompts } of results) {
          for (const prompt of prompts) {
            allPrompts.push(namespacePrompt(name, prompt));
          }
        }

        // Cache the aggregated result
        this.promptCache.set(session, {
          prompts: allPrompts,
          timestamp: Date.now(),
        });

        this.logger.info(
          `Aggregated ${allPrompts.length} prompts from ${clients.size} servers for session '${session}'`,
        );

        return {
          prompts: allPrompts,
        };
      },
    );

    // Handler for getting a specific prompt
    this.server.server.setRequestHandler(
      GetPromptRequestSchema,
      async (
        request: {
          params: { name: string; arguments?: Record<string, string> };
        },
        { sessionId }: { sessionId?: string },
      ): Promise<GetPromptResult> => {
        const session = sessionId || "default";
        const { name, arguments: promptArgs } = request.params;

        // Parse the namespaced name
        const parsed = parsePromptName(name);
        if (!parsed) {
          throw new Error(
            `Invalid prompt name format: '${name}'. Expected format: {server-name}/{prompt-name}`,
          );
        }

        const { serverName, originalName } = parsed;

        // Get all clients for this session
        const clients = this.clientPool.getClientsBySession(session);

        // Find the client matching the server name
        const client = clients.get(serverName);
        if (!client) {
          const availableServers = Array.from(clients.keys()).join(", ");
          throw new Error(
            `Server '${serverName}' not found in session '${session}'. Available servers: ${availableServers || "none"}`,
          );
        }

        // Get the prompt from the client
        try {
          const result = await client.getPrompt({
            name: originalName,
            arguments: promptArgs,
          });
          this.logger.debug(
            `Got prompt '${originalName}' from server '${serverName}'`,
          );
          return result;
        } catch (error) {
          this.logger.error(
            `Failed to get prompt '${originalName}' from server '${serverName}':`,
            error as Error,
          );
          throw error;
        }
      },
    );

    this.logger.info("MCP gateway prompt handlers registered");
  }

  private gatherServerInfo(
    mcpServers: Map<string, MCPClientSession>,
  ): ServerListItem[] {
    const serverList: ServerListItem[] = [];

    for (const [originalName, client] of mcpServers.entries()) {
      const luaIdentifier = sanitizeLuaIdentifier(originalName);

      try {
        const serverInfo = client.getServerVersion();
        let instructions: string | undefined;

        try {
          instructions = client.getInstructions();
        } catch {
          instructions = undefined;
        }

        serverList.push({
          luaIdentifier,
          serverInfo: {
            name: serverInfo?.name,
            description: serverInfo?.description,
            version: serverInfo?.version,
            instructions,
          },
        });
      } catch (error) {
        this.logger.error(
          `Failed to get info for server '${originalName}':`,
          error as Error,
        );
        serverList.push({
          luaIdentifier,
          error: `Failed to retrieve server info: ${error}`,
        });
      }
    }

    return serverList;
  }

  private formatServerList(sessionId: string, serverList: ServerListItem[]) {
    const lines = [
      `Session: ${sessionId}`,
      `Available MCP Servers: ${serverList.length}`,
      "",
    ];

    if (serverList.length === 0) {
      lines.push("No servers available in this session.");
      lines.push(
        "💡 Tip: Servers are configured when the session is initialized.",
      );
      return lines.join("\n");
    }

    for (const server of serverList) {
      if ("error" in server) {
        lines.push(
          `❌ ${server.luaIdentifier}`,
          `   Error: ${server.error}`,
          "",
        );
        continue;
      }

      lines.push(`📦 ${server.luaIdentifier}`);

      const fields: Array<[string, string | undefined]> = [
        ["Name", server.serverInfo.name],
        ["Version", server.serverInfo.version],
        [
          "Description",
          server.serverInfo.description || "(No description provided)",
        ],
        ["Instructions", server.serverInfo.instructions],
      ];

      for (const [label, value] of fields) {
        if (value) lines.push(`   ${label}: ${value}`);
      }

      lines.push("");
    }

    lines.push(
      "💡 Tip: Use list-server-tools to see available tools for each server",
    );

    return lines.join("\n");
  }

  private async gatherToolInfo(client: MCPClientSession): Promise<ToolInfo[]> {
    const toolsResponse = await client.listTools();
    const tools = toolsResponse.tools || [];

    return tools.map((tool) => ({
      luaName: sanitizeLuaIdentifier(tool.name),
      description: tool.description || "",
    }));
  }

  private formatToolList(luaServerName: string, tools: ToolInfo[]): string {
    const lines = [
      `Server: ${luaServerName}`,
      `Available Tools: ${tools.length}`,
      "",
    ];

    if (tools.length === 0) {
      lines.push("No tools available on this server.");
      return lines.join("\n");
    }

    for (const tool of tools) {
      lines.push(`🔧 ${tool.luaName}`);

      const description = tool.description || "(No description provided)";
      const truncated =
        description.length > 100
          ? `${description.slice(0, 100)}...`
          : description;
      lines.push(`   ${truncated}`);

      lines.push("");
    }

    lines.push(
      `💡 Tip: Use tool-details with luaServerName="${luaServerName}" to see full schemas`,
    );

    return lines.join("\n");
  }

  private findClientByLuaName(
    mcpServers: Map<string, MCPClientSession>,
    luaName: string,
  ): MCPClientSession | null {
    for (const [originalName, client] of mcpServers.entries()) {
      if (sanitizeLuaIdentifier(originalName) === luaName) {
        return client;
      }
    }
    return null;
  }

  private formatToolDetails(
    luaServerName: string,
    luaToolName: string,
    tool: {
      name: string;
      description?: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
    },
  ): string {
    const lines = [`Server: ${luaServerName}`, `Tool: ${luaToolName}`, ""];

    if (tool.description) {
      lines.push("Description:", tool.description, "");
    } else {
      lines.push("Description:", "(No description provided)", "");
    }

    if (tool.inputSchema) {
      lines.push("Input Schema:");
      const schemaLines = formatSchema(tool.inputSchema);
      if (schemaLines.length === 0) {
        lines.push("  (No input parameters)", "");
      } else {
        lines.push(...schemaLines);
        lines.push("");
      }
    }

    if (tool.outputSchema) {
      lines.push("Output Schema:");
      const schemaLines = formatSchema(tool.outputSchema);
      if (schemaLines.length === 0) {
        lines.push("  (No output schema defined)", "");
      } else {
        lines.push(...schemaLines);
        lines.push("");
      }
    }

    // Add usage example
    lines.push("Usage Example:");
    lines.push(`  local result = ${luaServerName}.${luaToolName}({`);

    // Try to generate example args from schema
    const exampleArgs = this.generateExampleArgs(tool.inputSchema);
    if (exampleArgs.length > 0) {
      lines.push(...exampleArgs.map((arg) => `    ${arg}`));
    } else {
      lines.push("    -- No required parameters");
    }

    lines.push("  }):await()");
    lines.push("");

    return lines.join("\n");
  }

  private generateExampleArgs(schema: unknown): string[] {
    if (!schema || typeof schema !== "object") {
      return [];
    }

    const schemaObj = schema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    if (!schemaObj.properties) {
      return [];
    }

    const required = new Set(schemaObj.required || []);
    const args: string[] = [];

    for (const [fieldName, fieldSchema] of Object.entries(
      schemaObj.properties,
    )) {
      if (required.has(fieldName)) {
        const fieldSchemaObj = fieldSchema as { type?: string };
        const exampleValue = this.getExampleValue(fieldSchemaObj.type);
        args.push(`${fieldName} = ${exampleValue},`);
      }
    }

    return args;
  }

  private getExampleValue(type?: string): string {
    switch (type) {
      case "string":
        return '"example"';
      case "number":
        return "42";
      case "boolean":
        return "true";
      case "array":
        // This is Lua syntax for an empty table (array)
        return "{}";
      case "object":
        return "{}";
      default:
        return '"value"';
    }
  }

  getServer(): McpServer {
    return this.server;
  }
}
