import { injectable, inject } from "inversify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type {
  ILuaRuntime,
  IMCPClientManager,
  ILogger,
} from "../types/interfaces.js";
import { TYPES } from "../types/index.js";

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
    // Tool to execute Lua scripts
    this.server.registerTool(
      "execute-lua",
      {
        description: "Execute a Lua script with access to MCP servers",
        inputSchema: {
          script: z.string().describe("Lua script to execute"),
        },
      },
      async ({ script }): Promise<CallToolResult> => {
        try {
          const result = await this.luaRuntime.executeScript(script);
          return {
            content: [
              {
                type: "text",
                text: `Script executed successfully: ${JSON.stringify(result)}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Script execution failed: ${error}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    this.logger.info("MCP gateway tools registered");
  }

  getServer(): McpServer {
    return this.server;
  }
}
