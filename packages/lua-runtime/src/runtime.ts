import { LuaFactory, LuaEngine } from "wasmoon";
import type {
  ILuaRuntime,
  ILogger,
  IMCPClientSession,
  IGatewayBuiltins,
} from "./types.js";
import {
  sanitizeLuaIdentifier,
  namespaceCallToolResultResources,
} from "@my-cool-proxy/mcp-utilities";
import {
  takeResult,
  type ResponseMessage,
} from "@modelcontextprotocol/sdk/experimental";
import {
  CallToolResultSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { inspect } from "node:util";

export class WasmoonRuntime implements ILuaRuntime {
  private factory: LuaFactory;

  constructor(private logger: ILogger) {
    this.factory = new LuaFactory();
  }

  async executeScript(
    script: string,
    mcpServers: Map<string, IMCPClientSession>,
    gatewayBuiltins: IGatewayBuiltins,
  ): Promise<unknown> {
    this.logger.debug(`Executing Lua script:\n${script}`);

    let finalResult: unknown;
    const engine = await this.createEngine((result: unknown) => {
      finalResult = result;
    });

    try {
      // Inject MCP servers as Lua globals
      await this.injectMCPServers(engine, mcpServers);

      // Inject gateway builtins as _gateway global
      this.injectGatewayBuiltins(engine, gatewayBuiltins);

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
    mcpServers: Map<string, IMCPClientSession>,
  ): Promise<void> {
    for (const [originalServerName, client] of mcpServers.entries()) {
      try {
        // Sanitize server name for Lua
        const sanitizedServerName = sanitizeLuaIdentifier(originalServerName);

        // List available tools from the MCP server
        const tools = await client.listTools();

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
                ) as AsyncGenerator<ResponseMessage<CallToolResult>>,
              );

              // IMPORTANT: Namespace resource URIs in tool results here!
              // This MUST happen at the tool call level because:
              // 1. We have the server context (originalServerName) here
              // 2. Lua scripts can call tools from multiple servers
              // 3. By the time results reach the gateway server, we've lost which
              //    server each resource came from
              // This ensures clients can directly use resource URIs from tool results
              // without manual namespacing (e.g., file:///data.json becomes
              // gw://data-server/file:///data.json)
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

  /**
   * Inject gateway built-in functions as the _gateway global table.
   * The underscore prefix indicates a reserved/internal table, preventing
   * collision if a user registers an MCP server named "gateway".
   */
  private injectGatewayBuiltins(
    engine: LuaEngine,
    builtins: IGatewayBuiltins,
  ): void {
    const gatewayTable: Record<string, unknown> = {};

    // Core builtins (always available)
    gatewayTable["list_resources"] = async () => {
      this.logger.debug("Calling _gateway.list_resources()");
      return builtins.listResources();
    };

    gatewayTable["read_resource"] = async (args: { uri: string }) => {
      const uri = args?.uri;
      this.logger.debug(`Calling _gateway.read_resource({ uri = "${uri}" })`);
      return builtins.readResource(uri);
    };

    gatewayTable["summary_stats"] = async () => {
      this.logger.debug("Calling _gateway.summary_stats()");
      return builtins.summaryStats();
    };

    gatewayTable["list_prompts"] = async () => {
      this.logger.debug("Calling _gateway.list_prompts()");
      return builtins.listPrompts();
    };

    gatewayTable["get_prompt"] = async (args: {
      name: string;
      arguments?: Record<string, string>;
    }) => {
      const name = args?.name;
      this.logger.debug(`Calling _gateway.get_prompt({ name = "${name}" })`);
      return builtins.getPrompt(name, args?.arguments);
    };

    // Conditional builtins (only when skills are enabled)
    if (builtins.invokeSkillScript) {
      const invokeSkillScript = builtins.invokeSkillScript;
      gatewayTable["invoke_skill_script"] = async (args: {
        skillName: string;
        script: string;
        args?: string[];
      }) => {
        this.logger.debug(
          `Calling _gateway.invoke_skill_script({ skillName = "${args?.skillName}", script = "${args?.script}" })`,
        );
        return invokeSkillScript(args?.skillName, args?.script, args?.args);
      };
    }

    if (builtins.writeSkill) {
      const writeSkill = builtins.writeSkill;
      gatewayTable["write_skill"] = async (args: {
        skillName: string;
        content?: string;
        files?: Array<{ path: string; content: string }>;
      }) => {
        this.logger.debug(
          `Calling _gateway.write_skill({ skillName = "${args?.skillName}" })`,
        );
        return writeSkill(args?.skillName, args?.content, args?.files);
      };
    }

    // Set as global with underscore prefix
    engine.global.set("_gateway", gatewayTable);

    this.logger.debug(
      `Injected _gateway global with builtins: ${Object.keys(gatewayTable).join(", ")}`,
    );
  }
}
