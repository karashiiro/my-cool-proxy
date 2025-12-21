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
import { namespaceCallToolResultResources } from "../utils/resource-uri.js";
import { inspect } from "node:util";

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
    let finalResult: unknown;
    const engine = await this.createEngine((result: unknown) => {
      finalResult = result;
    });

    try {
      // Inject MCP servers as Lua globals
      await this.injectMCPServers(engine, mcpServers);

      await engine.doString(script);
      return finalResult;
    } catch (error) {
      this.logger.error("Lua script execution failed", error as Error);

      // Check for common result() shadowing error
      if (
        error instanceof Error &&
        error.message.includes("self is not a function")
      ) {
        const hint = `
💡 HINT: You may have shadowed the global 'result' function with a local variable.
❌ Incorrect: local result = someFunction():await()
✅ Correct: local res = someFunction():await(); result(res)

The 'result' function is global - don't use 'local result = ...' as this overwrites it.
        `.trim();
        this.logger.error(hint);
        throw new Error(`${error.message}\n${hint}`);
      }

      throw error;
    } finally {
      engine.global.close();
    }
  }

  private async createEngine(
    resultCallback: (result: unknown) => void,
  ): Promise<LuaEngine> {
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

    // Add a function to return the final result
    engine.global.set("result", (res: unknown) => {
      resultCallback(res);
    });

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
                  `(Lua: ${sanitizedServerName}.${sanitizedToolName}) with args: ${inspect(args)}`,
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

              // IMPORTANT: Namespace resource URIs in tool results here!
              // This MUST happen at the tool call level because:
              // 1. We have the server context (originalServerName) here
              // 2. Lua scripts can call tools from multiple servers
              // 3. By the time results reach the gateway server, we've lost which
              //    server each resource came from
              // This ensures clients can directly use resource URIs from tool results
              // without manual namespacing (e.g., file:///data.json becomes
              // mcp://data-server/file:///data.json)
              const namespacedResult = namespaceCallToolResultResources(
                originalServerName,
                result,
              );

              if (namespacedResult.structuredContent) {
                // Directly return structured content as Lua table
                return namespacedResult.structuredContent;
              }

              if (
                namespacedResult.content.length === 1 &&
                namespacedResult.content[0]?.type === "text"
              ) {
                // If single text content, attempt to parse as JSON
                try {
                  return JSON.parse(namespacedResult.content[0].text);
                } catch {
                  // ignored
                }
              }

              return namespacedResult;
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
