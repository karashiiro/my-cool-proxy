import { injectable, inject } from "inversify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type {
  ILuaRuntime,
  IMCPClientManager,
  ILogger,
} from "../types/interfaces.js";
import { TYPES } from "../types/index.js";
import { sanitizeLuaIdentifier } from "../utils/lua-identifier.js";
import { formatSchema } from "../utils/schema-formatter.js";
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
        },
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
