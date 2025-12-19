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
  readonly description = `Execute a Lua script that can call tools on available MCP servers.
MCP servers are available as globals with their Lua identifiers.

Use list-servers to see available servers, list-server-tools to see the tools on a particular
server, and tool-details to get full information for a single tool. You MUST use tool-details
at least once for each tool you want to call to understand its inputs and outputs.

Wherever possible, combine multiple tool calls into a single script to avoid returning unnecessary data.

To return a value, call the global result() function with the value as an argument.
Tool calls return promises - use :await() to get the result.
Example: result(server_name.tool_name({ arg = "value" }):await())`;

  readonly schema = {
    script: z
      .string()
      .describe(
        "Lua script to execute. Available servers are accessible as global variables. " +
          "Tool calls return promises, so use :await() to unwrap them. " +
          "Call the global result() function to return a value from the script.",
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
