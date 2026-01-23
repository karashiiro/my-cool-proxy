import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sanitizeLuaIdentifier } from "@my-cool-proxy/mcp-utilities";
import type {
  IMCPClientManager,
  IMCPClientSession,
  ILogger,
  ILuaRuntime,
  ServerListItem,
} from "./types.js";
import { MCPFormatterService } from "./mcp-formatter-service.js";
import { inspect } from "node:util";

export class ToolDiscoveryService {
  private formatter: MCPFormatterService;

  constructor(
    private clientPool: IMCPClientManager,
    private logger: ILogger,
    private luaRuntime: ILuaRuntime,
    formatter?: MCPFormatterService,
  ) {
    this.formatter = formatter ?? new MCPFormatterService();
  }

  /**
   * Convert a JavaScript object to Lua table syntax
   * @param obj - The object to convert
   * @returns Lua table syntax string
   */
  private jsonToLuaTable(obj: Record<string, unknown>): string {
    if (typeof obj !== "object" || obj === null) {
      return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
      const items = obj.map((item) =>
        typeof item === "object"
          ? this.jsonToLuaTable(item as Record<string, unknown>)
          : JSON.stringify(item),
      );
      return `{${items.join(", ")}}`;
    }

    const pairs = Object.entries(obj).map(([key, value]) => {
      const luaKey = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) ? key : `["${key}"]`;
      const luaValue =
        typeof value === "object" && value !== null
          ? this.jsonToLuaTable(value as Record<string, unknown>)
          : JSON.stringify(value);
      return `${luaKey} = ${luaValue}`;
    });

    return `{${pairs.join(", ")}}`;
  }

  async listServers(sessionId: string): Promise<CallToolResult> {
    try {
      const effectiveSessionId = sessionId || "default";
      const mcpServers =
        this.clientPool.getClientsBySession(effectiveSessionId);
      const failedServers =
        this.clientPool.getFailedServers(effectiveSessionId);

      // Gather info from connected servers
      const serverList = this.gatherServerInfo(mcpServers);

      // Add failed servers to the list with error status
      // Note: We don't expose internal error details to clients for security
      // Detailed errors are logged server-side in client-manager.ts
      for (const [name] of failedServers.entries()) {
        serverList.push({
          luaIdentifier: sanitizeLuaIdentifier(name),
          error: "Connection failed",
        });
      }

      const formattedOutput = this.formatter.formatServerList(
        effectiveSessionId,
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

      const tools = await client.listTools();
      const tool = tools.find(
        (t) => sanitizeLuaIdentifier(t.name) === luaToolName,
      );

      if (!tool) {
        const availableTools = tools.map((t) => sanitizeLuaIdentifier(t.name));
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

  async inspectToolResponse(
    luaServerName: string,
    luaToolName: string,
    sampleArgs: Record<string, unknown>,
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

      const tools = await client.listTools();
      const tool = tools.find(
        (t) => sanitizeLuaIdentifier(t.name) === luaToolName,
      );

      if (!tool) {
        const availableTools = tools.map((t) => sanitizeLuaIdentifier(t.name));
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

      // Actually execute the tool with sample args through the Lua runtime
      // This ensures the response structure matches what LLMs will see in execute scripts
      this.logger.info(
        `Inspecting tool response: ${luaServerName}.${luaToolName} with args: ${inspect(sampleArgs)}`,
      );

      // Generate a Lua script that calls the tool and returns the result
      const luaArgs = this.jsonToLuaTable(sampleArgs);
      const luaScript = `result(${luaServerName}.${luaToolName}(${luaArgs}):await())`;

      this.logger.debug(`Generated inspection script: ${luaScript}`);

      // Execute through the Lua runtime to get the same result structure as execute tool
      const response = await this.luaRuntime.executeScript(
        luaScript,
        mcpServers,
      );

      // Format the response for display
      const responseText = JSON.stringify(response, null, 2);
      const argsText = JSON.stringify(sampleArgs, null, 2);

      const output = [
        `[!] Tool executed: ${luaServerName}.${luaToolName}`,
        ``,
        `Arguments used:`,
        argsText,
        ``,
        `Sample Response Structure (as seen from Lua):`,
        responseText,
        ``,
        `[i] This is exactly what you'll see when calling this tool in an execute script.`,
        `[i] Use this structure to extract only needed fields.`,
        `[i] Example: local res = ${luaServerName}.${luaToolName}({...}):await()`,
        `[i] Then access fields like: res.fieldName or res.items[1].fieldName`,
      ].join("\n");

      return { content: [{ type: "text", text: output }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to inspect tool response: ${error}\n\n[!] The tool may have been executed before this error occurred.`,
          },
        ],
        isError: true,
      };
    }
  }

  private gatherServerInfo(mcpServers: Map<string, IMCPClientSession>) {
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

  private async gatherToolInfo(client: IMCPClientSession) {
    const tools = await client.listTools();
    return tools.map((tool) => ({
      luaName: sanitizeLuaIdentifier(tool.name),
      description: tool.description || "",
    }));
  }

  private findClientByLuaName(
    mcpServers: Map<string, IMCPClientSession>,
    luaName: string,
  ): IMCPClientSession | null {
    for (const [originalName, client] of mcpServers.entries()) {
      if (sanitizeLuaIdentifier(originalName) === luaName) {
        return client;
      }
    }
    return null;
  }
}

export default ToolDiscoveryService;
