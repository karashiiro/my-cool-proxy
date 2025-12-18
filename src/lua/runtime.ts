import { injectable, inject } from "inversify";
import { LuaFactory, LuaEngine } from "wasmoon";
import type { ILuaRuntime, ILogger } from "../types/interfaces.js";
import { TYPES } from "../types/index.js";
import { sanitizeLuaIdentifier } from "../utils/lua-identifier.js";
import {
  takeResult,
  type ResponseMessage,
} from "@modelcontextprotocol/sdk/experimental";
import type { MCPClientSession } from "../mcp/client-session.js";
import {
  CallToolResultSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

@injectable()
export class WasmoonRuntime implements ILuaRuntime {
  private factory: LuaFactory;

  constructor(@inject(TYPES.Logger) private logger: ILogger) {
    this.factory = new LuaFactory();
  }

  async executeScript(
    script: string,
    mcpServers: Map<string, MCPClientSession>,
  ): Promise<unknown> {
    const engine = await this.createEngine();
    try {
      // Inject MCP servers as Lua globals
      await this.injectMCPServers(engine, mcpServers);

      await engine.doString(script);
      const result = engine.global.get("result");
      return result;
    } catch (error) {
      this.logger.error("Lua script execution failed", error as Error);
      throw error;
    } finally {
      engine.global.close();
    }
  }

  private async createEngine(): Promise<LuaEngine> {
    const engine = await this.factory.createEngine();

    // Remove dangerous OS access
    engine.global.set("os", undefined);

    // Remove file I/O
    engine.global.set("io", undefined);

    // Remove module loading capabilities
    engine.global.set("require", undefined);
    engine.global.set("dofile", undefined);
    engine.global.set("loadfile", undefined);
    engine.global.set("package", undefined);

    // Remove debug facilities
    engine.global.set("debug", undefined);

    return engine;
  }

  private async injectMCPServers(
    engine: LuaEngine,
    mcpServers: Map<string, MCPClientSession>,
  ): Promise<void> {
    for (const [originalServerName, client] of mcpServers.entries()) {
      try {
        // Sanitize server name for Lua
        const sanitizedServerName = sanitizeLuaIdentifier(originalServerName);

        // List available tools from the MCP server
        const toolsResponse = await client.listTools();
        const tools = toolsResponse.tools;

        // Create a Lua table for this server
        const serverTable: Record<string, unknown> = {};

        // Add each tool as a function on the server table
        for (const tool of tools) {
          const originalToolName = tool.name;
          const sanitizedToolName = sanitizeLuaIdentifier(originalToolName);

          // Capture original names in closure for MCP calls
          serverTable[sanitizedToolName] = async (args: unknown) => {
            try {
              this.logger.debug(
                `Calling ${originalServerName}.${originalToolName} ` +
                  `(Lua: ${sanitizedServerName}.${sanitizedToolName}) with args:`,
                args,
              );

              const result = await takeResult<
                CallToolResult,
                AsyncGenerator<ResponseMessage<CallToolResult>>
              >(
                client.experimental.tasks.callToolStream(
                  {
                    name: originalToolName,
                    arguments: (args as Record<string, unknown>) || {},
                  },
                  CallToolResultSchema,
                ),
              );

              if (result.structuredContent) {
                // Directly return structured content as Lua table
                return result.structuredContent;
              }

              if (
                result.content.length === 1 &&
                result.content[0]?.type === "text"
              ) {
                // If single text content, attempt to parse as JSON
                try {
                  return JSON.parse(result.content[0].text);
                } catch {
                  // ignored
                }
              }

              return result;
            } catch (error) {
              this.logger.error(
                `Error calling ${originalServerName}.${originalToolName}:`,
                error as Error,
              );
              throw error;
            }
          };
        }

        // Set the server table as a global in Lua using sanitized name
        engine.global.set(sanitizedServerName, serverTable);

        const nameInfo =
          sanitizedServerName !== originalServerName
            ? ` (Lua name: '${sanitizedServerName}')`
            : "";
        this.logger.debug(
          `Injected MCP server '${originalServerName}'${nameInfo} with ${tools.length} tools`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to inject MCP server '${originalServerName}':`,
          error as Error,
        );
        // Continue with other servers even if one fails
      }
    }
  }
}
