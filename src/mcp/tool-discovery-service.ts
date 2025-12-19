import { injectable, inject } from "inversify";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  IMCPClientManager,
  ILogger,
  ServerListItem,
} from "../types/interfaces.js";
import { TYPES } from "../types/index.js";
import { sanitizeLuaIdentifier } from "../utils/lua-identifier.js";
import type { MCPClientSession } from "./client-session.js";
import { MCPFormatterService } from "./mcp-formatter-service.js";

@injectable()
export class ToolDiscoveryService {
  constructor(
    @inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @inject(TYPES.Logger) private logger: ILogger,
    @inject(TYPES.MCPFormatterService) private formatter: MCPFormatterService,
  ) {}

  async listServers(sessionId: string): Promise<CallToolResult> {
    try {
      const mcpServers = this.clientPool.getClientsBySession(
        sessionId || "default",
      );
      const serverList = this.gatherServerInfo(mcpServers);
      const formattedOutput = this.formatter.formatServerList(
        sessionId || "default",
        serverList,
      );

      return { content: [{ type: "text", text: formattedOutput }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to list servers: ${error}` }],
        isError: true,
      };
    }
  }

  async listServerTools(
    luaServerName: string,
    sessionId: string,
  ): Promise<CallToolResult> {
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
          availableServers.length > 0 ? availableServers.join(", ") : "none";
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
      const formattedOutput = this.formatter.formatToolList(
        luaServerName,
        tools,
      );

      return { content: [{ type: "text", text: formattedOutput }] };
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
  }

  async getToolDetails(
    luaServerName: string,
    luaToolName: string,
    sessionId: string,
  ): Promise<CallToolResult> {
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
          availableServers.length > 0 ? availableServers.join(", ") : "none";
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

      const formattedOutput = this.formatter.formatToolDetails(
        luaServerName,
        luaToolName,
        tool,
      );
      return { content: [{ type: "text", text: formattedOutput }] };
    } catch (error) {
      return {
        content: [
          { type: "text", text: `Failed to get tool details: ${error}` },
        ],
        isError: true,
      };
    }
  }

  private gatherServerInfo(mcpServers: Map<string, MCPClientSession>) {
    const serverList: Array<ServerListItem> = [];

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

  private async gatherToolInfo(client: MCPClientSession) {
    const toolsResponse = await client.listTools();
    const tools = toolsResponse.tools || [];

    return tools.map((tool) => ({
      luaName: sanitizeLuaIdentifier(tool.name),
      description: tool.description || "",
    }));
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
}

export default ToolDiscoveryService;
