import { injectable, inject } from "inversify";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import type {
  ILuaRuntime,
  IMCPClientManager,
  ILogger,
} from "../types/interfaces.js";
import { TYPES } from "../types/index.js";
import type { ITool, ToolExecutionContext } from "./base-tool.js";

/**
 * Tool that executes Lua scripts with access to MCP servers.
 *
 * This tool allows executing arbitrary Lua code that can call tools on
 * available MCP servers. It's the primary way to orchestrate multi-server
 * tool calls.
 */
@injectable()
export class ExecuteLuaTool implements ITool {
  readonly name = "execute";
  readonly description = `Execute a Lua script that orchestrates tool calls across MCP servers. This is the primary way to use specialized tools discovered through this gateway.

WORKFLOW:
1. Call list-servers to discover available MCP servers
2. Call list-server-tools to see what each server provides
3. Call tool-details for each tool you plan to use (REQUIRED - brief descriptions are insufficient)
4. OPTIONAL: Call inspect-tool-response to see sample output structure for better data extraction
5. Call execute with a Lua script that uses those tools

SCRIPT SYNTAX:
- MCP servers are available as global variables using their Lua identifiers
- Tool calls return promises - use :await() to unwrap them
- Call result() to return a value from your script
- Example: result(server_name.tool_name({ arg = "value" }):await())

OPTIMIZATION:
1. Combine multiple tool calls into a single script to avoid returning large intermediate results
2. ALWAYS paginate exhaustively when responses include pagination indicators (total_count, hasMore, nextCursor, page, etc.)
   - Use a while loop to fetch ALL pages, not just the first page
   - Only skip pagination if the user explicitly requests partial/sample results
   - Process and aggregate data across all pages in Lua before returning
3. Process responses in Lua to extract only needed fields before returning - Lua processing is cheap,
   but returning large JSON objects wastes tokens
4. Example: Instead of returning raw responses, extract specific fields into a summary table`;

  readonly schema = {
    script: z
      .string()
      .describe(
        "Lua script to execute. See tool description for syntax and workflow.",
      ),
  };

  constructor(
    @inject(TYPES.LuaRuntime) private luaRuntime: ILuaRuntime,
    @inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @inject(TYPES.Logger) private logger: ILogger,
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    const { script } = args;
    const mcpServers = this.clientPool.getClientsBySession(
      context.sessionId || "default",
    );

    try {
      const result = await this.luaRuntime.executeScript(
        script as string,
        mcpServers,
      );

      // Check if result is already a valid CallToolResult
      if (
        result &&
        typeof result === "object" &&
        "content" in result &&
        Array.isArray((result as Record<string, unknown>).content)
      ) {
        const parseResult = CallToolResultSchema.safeParse(result);
        if (parseResult.success) return parseResult.data;
      }

      // Return structured result if it's an object
      if (result !== null && typeof result === "object") {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      }

      // Return simple text result
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
      this.logger.error(`Lua script execution failed: ${error}`);
      return {
        content: [{ type: "text", text: `Script execution failed:\n${error}` }],
        isError: true,
      };
    }
  }
}
