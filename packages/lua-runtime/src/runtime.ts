import { LuaFactory, type LuaEngine } from "wasmoon";
import type {
  ILuaRuntime,
  ILogger,
  IMCPClientSession,
  IGatewayBuiltins,
  IToolCallLog,
} from "./types.js";
import {
  sanitizeLuaIdentifier,
  getErrorMessage,
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
import { ProgressAggregator } from "./progress-aggregator.js";

export { ProgressAggregator } from "./progress-aggregator.js";

export class WasmoonRuntime implements ILuaRuntime {
  private factory: LuaFactory;

  constructor(private logger: ILogger) {
    this.factory = new LuaFactory();
  }

  async executeScript(
    script: string,
    mcpServers: ReadonlyMap<string, IMCPClientSession>,
    gatewayBuiltins: IGatewayBuiltins,
    onProgress?: (progress: number, total?: number, message?: string) => void,
    toolCallLog?: IToolCallLog,
  ): Promise<unknown> {
    this.logger.info(`Executing Lua script:\n${script}`);

    let finalResult: unknown;
    const engine = await this.createEngine((result: unknown) => {
      finalResult = result;
    });

    // Create aggregator if progress reporting is requested
    const aggregator = onProgress
      ? new ProgressAggregator(onProgress)
      : undefined;

    try {
      // Inject MCP servers as Lua globals
      await this.injectMCPServers(
        engine,
        mcpServers,
        gatewayBuiltins,
        aggregator,
        toolCallLog,
      );

      // Inject gateway builtins as _gateway global
      this.injectGatewayBuiltins(engine, gatewayBuiltins);

      await engine.doString(script);
      return finalResult;
    } catch (error) {
      if (error instanceof Error) {
        // Check for common result() shadowing error
        if (error.message.includes("self is not a function")) {
          const hint = `
💡 HINT: You may have shadowed the global 'result' function with a local variable.
❌ Incorrect: local result = someFunction():await()
✅ Correct: local res = someFunction():await(); result(res)

The 'result' function is global - don't use 'local result = ...' as this overwrites it.
          `.trim();
          throw new Error(`${error.message}\n${hint}`);
        }

        // Check for "server not found" - attempting to use an undefined global
        const nilGlobalMatch = error.message.match(
          /attempt to index a nil value \(global '([^']+)'\)/,
        );
        if (nilGlobalMatch) {
          const attemptedName = nilGlobalMatch[1];
          const availableServers = Array.from(mcpServers.keys())
            .map((name) => sanitizeLuaIdentifier(name))
            .join(", ");

          const hint = `
💡 HINT: '${attemptedName}' is not a recognized server or global variable.

Available servers: ${availableServers || "(none connected)"}

Common issues:
• Server names are sanitized for Lua (hyphens → underscores, e.g., 'my-server' → 'my_server')
• Use list-servers tool to discover available servers before writing scripts
• Server may have failed to connect - check gateway logs
          `.trim();
          throw new Error(`${error.message}\n\n${hint}`);
        }

        // Check for "tool not found" - attempting to call a non-existent tool on a server
        const nilFieldMatch = error.message.match(
          /attempt to call a nil value \(field '([^']+)'\)/,
        );
        if (nilFieldMatch) {
          const attemptedTool = nilFieldMatch[1];

          const hint = `
💡 HINT: '${attemptedTool}' is not a recognized tool on this server.

Common issues:
• Tool names are sanitized for Lua (hyphens → underscores, e.g., 'get-data' → 'get_data')
• Use list-server-tools to discover available tools on each server
• Use tool-details to get the exact tool name and parameters before calling
          `.trim();
          throw new Error(`${error.message}\n\n${hint}`);
        }
      }

      throw error;
    } finally {
      engine.global.close();
    }
  }

  /**
   * Attach a no-op `.catch()` to a promise being returned to wasmoon, so
   * an unawaited rejection from the Lua bridge cannot become an
   * unhandledRejection event that crashes the Node process.
   *
   * Multiple handlers can attach to the same promise — they fire
   * independently. Lua's `:await()` (which attaches its own
   * `.then(resolve, reject)`) still observes the rejection normally;
   * the no-op catch only consumes Node's "this rejection has no
   * handler" signal at the JS layer.
   *
   * Apply this to EVERY promise returned to wasmoon from the Lua
   * bridge — both the per-server tool wrappers and every `_gateway`
   * builtin. The process-level unhandledRejection handler in
   * `apps/gateway/src/index.ts` is a backstop, not a substitute: with
   * this guard in place, any rejection that reaches the process
   * handler is genuinely a non-Lua-bridge bug.
   */
  private suppressOrphanRejection<T>(promise: Promise<T>): Promise<T> {
    promise.catch(() => {
      /* intentionally swallowed; Lua's :await() still sees the rejection */
    });
    return promise;
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
    mcpServers: ReadonlyMap<string, IMCPClientSession>,
    gatewayBuiltins: IGatewayBuiltins,
    aggregator?: ProgressAggregator,
    toolCallLog?: IToolCallLog,
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

          // Async path: actually invokes the upstream tool. Kept as a
          // separate function so the guard check above can run on the
          // synchronous call stack — see the comment on the outer
          // wrapper for why that matters.
          const callTool = async (
            args: unknown,
            logCallId: string | undefined,
          ): Promise<unknown> => {
            try {
              this.logger.debug(
                `Calling ${originalServerName}.${originalToolName} ` +
                  `(Lua: ${sanitizedServerName}.${sanitizedToolName}) with args: ${inspect(args)}`,
              );

              // Register with progress aggregator if available.
              // Registration happens at call time (not injection time) so
              // tools called multiple times each get their own progress slot.
              let callToolOptions:
                | {
                    onprogress?: (progress: {
                      progress: number;
                      total?: number;
                      message?: string;
                    }) => void;
                  }
                | undefined;

              if (aggregator) {
                const callId = aggregator.register();
                callToolOptions = {
                  onprogress: (p) => aggregator.update(callId, p),
                };
              }

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
                  callToolOptions,
                ) as AsyncGenerator<ResponseMessage<CallToolResult>>,
              );

              // Register resource URIs found in tool results for routing.
              // We have the server context (originalServerName) here,
              // which is needed because Lua scripts can call tools from
              // multiple servers. The routing service maps URIs to their
              // source server for subsequent resource reads.
              if (gatewayBuiltins.registerResourceUri) {
                for (const block of result.content) {
                  if (
                    typeof block === "object" &&
                    block !== null &&
                    "type" in block
                  ) {
                    if (block.type === "resource_link" && "uri" in block) {
                      gatewayBuiltins.registerResourceUri(
                        block.uri as string,
                        originalServerName,
                      );
                    }
                    if (
                      block.type === "resource" &&
                      "resource" in block &&
                      typeof block.resource === "object" &&
                      block.resource !== null &&
                      "uri" in block.resource
                    ) {
                      gatewayBuiltins.registerResourceUri(
                        block.resource.uri as string,
                        originalServerName,
                      );
                    }
                  }
                }
              }

              // Validate isError flag - throw so agents can't silently
              // extract error context as if it were successful data
              if (result.isError) {
                const errorText = result.content
                  .filter(
                    (c): c is { type: "text"; text: string } =>
                      c.type === "text",
                  )
                  .map((c) => c.text)
                  .join("\n");
                throw new Error(
                  `Tool '${originalServerName}.${originalToolName}' returned an error (isError: true):\n${errorText}`,
                );
              }

              // Log successful tool call result
              if (logCallId) {
                toolCallLog?.onToolCallEnd(logCallId, JSON.stringify(result));
              }

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
              if (logCallId) {
                toolCallLog?.onToolCallError(logCallId, getErrorMessage(error));
              }
              this.logger.error(
                `Error calling ${originalServerName}.${originalToolName}:`,
                error as Error,
              );
              throw error;
            }
          };

          // Synchronous outer wrapper.
          //
          // CRITICAL: this MUST stay non-async. The toolCallGuard's throw
          // has to propagate to wasmoon as a synchronous JS exception so
          // wasmoon can convert it into an immediate Lua error at the
          // call site. If this wrapper were `async`, the throw would be
          // captured by the async function machinery and turned into a
          // rejected promise — and Lua scripts that bind tool calls to
          // locals without an immediate `:await()` (a perfectly normal
          // pattern) would then have orphan rejected promises sitting in
          // their stack with no handler attached. As soon as an earlier
          // `:await()` aborts the chunk, those orphan rejections become
          // unhandledRejection events, which Node terminates the process
          // on by default. See the regression test in runtime.test.ts.
          serverTable[sanitizedToolName] = (args: unknown) => {
            // Log tool call start before the guard check, matching the
            // historical behavior where guard rejections still produce a
            // start/error pair in the tool call log.
            const logCallId = toolCallLog?.onToolCallStart(
              originalServerName,
              originalToolName,
              args ? JSON.stringify(args) : undefined,
            );

            // Enforce tool inspection guard if configured. Must be sync.
            if (gatewayBuiltins.toolCallGuard) {
              try {
                gatewayBuiltins.toolCallGuard(
                  sanitizedServerName,
                  sanitizedToolName,
                );
              } catch (error) {
                if (logCallId) {
                  toolCallLog?.onToolCallError(
                    logCallId,
                    getErrorMessage(error),
                  );
                }
                this.logger.error(
                  `Error calling ${originalServerName}.${originalToolName}:`,
                  error as Error,
                );
                throw error;
              }
            }

            // Wrap the returned promise so any unawaited rejection from
            // the upstream call (e.g. the script aborts on an earlier
            // `:await()` error before reaching this one) cannot escape
            // as an unhandledRejection. See suppressOrphanRejection for
            // the full reasoning.
            return this.suppressOrphanRejection(callTool(args, logCallId));
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

    // CRITICAL: every entry on this table MUST be a synchronous function
    // (no `async` keyword), and any promise it returns to wasmoon MUST
    // be passed through `suppressOrphanRejection` first. Both rules
    // exist to prevent the same class of unhandled-rejection crash that
    // killed the gateway in the per-tool wrapper:
    //
    //   1. Sync wrapper: if an underlying builtin throws synchronously
    //      (rather than returning `{ error: ... }` or rejecting its
    //      promise), the throw propagates through the sync wrapper to
    //      wasmoon as a sync JS exception, which wasmoon converts into
    //      an immediate Lua error at the call site. An `async` wrapper
    //      would instead capture the throw and convert it into a
    //      rejected promise — which Lua scripts that bind the call to
    //      a local without an immediate `:await()` would orphan.
    //
    //   2. suppressOrphanRejection: even legitimate async rejections
    //      can be orphaned if the Lua script binds the call to a local
    //      and aborts before awaiting it (e.g. an earlier `:await()`
    //      errors first). Attaching a no-op `.catch()` to the returned
    //      promise marks it as "handled" from Node's perspective, so
    //      the unawaited rejection never reaches Node's
    //      unhandledRejection event. Lua's `:await()` still observes
    //      the rejection because multiple handlers can attach to the
    //      same promise — they fire independently.
    //
    // See the regression tests in runtime.test.ts under "toolCallGuard
    // rejection handling" for the failure modes this guards against.

    // Core builtins (always available)
    gatewayTable["list_resources"] = () => {
      this.logger.debug("Calling _gateway.list_resources()");
      return this.suppressOrphanRejection(builtins.listResources());
    };

    gatewayTable["list_resource_templates"] = () => {
      this.logger.debug("Calling _gateway.list_resource_templates()");
      return this.suppressOrphanRejection(builtins.listResourceTemplates());
    };

    gatewayTable["read_resource"] = (args: { uri: string }) => {
      const uri = args?.uri;
      this.logger.debug(`Calling _gateway.read_resource({ uri = "${uri}" })`);
      return this.suppressOrphanRejection(builtins.readResource(uri));
    };

    gatewayTable["summary_stats"] = () => {
      this.logger.debug("Calling _gateway.summary_stats()");
      return this.suppressOrphanRejection(builtins.summaryStats());
    };

    gatewayTable["list_prompts"] = () => {
      this.logger.debug("Calling _gateway.list_prompts()");
      return this.suppressOrphanRejection(builtins.listPrompts());
    };

    gatewayTable["get_prompt"] = (args: {
      name: string;
      arguments?: Record<string, string>;
    }) => {
      const name = args?.name;
      this.logger.debug(`Calling _gateway.get_prompt({ name = "${name}" })`);
      return this.suppressOrphanRejection(
        builtins.getPrompt(name, args?.arguments),
      );
    };

    gatewayTable["complete"] = (args: {
      ref: { type: string; uri?: string; name?: string };
      argument: { name: string; value: string };
      context?: { arguments?: Record<string, string> };
    }) => {
      this.logger.debug(
        `Calling _gateway.complete({ ref.type = "${args?.ref?.type}" })`,
      );
      return this.suppressOrphanRejection(builtins.complete(args));
    };

    // Conditional builtins (only when skills are enabled)
    if (builtins.invokeSkillScript) {
      const invokeSkillScript = builtins.invokeSkillScript;
      gatewayTable["invoke_skill_script"] = (args: {
        skillName: string;
        script: string;
        args?: string[];
      }) => {
        this.logger.debug(
          `Calling _gateway.invoke_skill_script({ skillName = "${args?.skillName}", script = "${args?.script}" })`,
        );
        return this.suppressOrphanRejection(
          invokeSkillScript(args?.skillName, args?.script, args?.args),
        );
      };
    }

    if (builtins.writeSkill) {
      const writeSkill = builtins.writeSkill;
      gatewayTable["write_skill"] = (args: {
        skillName: string;
        content?: string;
        files?: Array<{ path: string; content: string }>;
      }) => {
        this.logger.debug(
          `Calling _gateway.write_skill({ skillName = "${args?.skillName}" })`,
        );
        return this.suppressOrphanRejection(
          writeSkill(args?.skillName, args?.content, args?.files),
        );
      };
    }

    if (builtins.updateSkill) {
      const updateSkill = builtins.updateSkill;
      gatewayTable["update_skill"] = (args: {
        skillName: string;
        file?: string;
        old_string: string;
        new_string: string;
        replace_all?: boolean;
      }) => {
        this.logger.debug(
          `Calling _gateway.update_skill({ skillName = "${args?.skillName}", file = "${args?.file ?? "SKILL.md"}" })`,
        );
        return this.suppressOrphanRejection(
          updateSkill(
            args?.skillName,
            args?.file ?? "SKILL.md",
            args?.old_string,
            args?.new_string,
            args?.replace_all,
          ),
        );
      };
    }

    // Conditional builtin: get_result (only when result offloading is enabled)
    if (builtins.getResult) {
      const getResult = builtins.getResult;
      gatewayTable["get_result"] = (args: { id: string }) => {
        this.logger.debug(
          `Calling _gateway.get_result({ id = "${args?.id}" })`,
        );
        return this.suppressOrphanRejection(getResult(args?.id));
      };
    }

    // Set as global with underscore prefix
    engine.global.set("_gateway", gatewayTable);

    this.logger.debug(
      `Injected _gateway global with builtins: ${Object.keys(gatewayTable).join(", ")}`,
    );
  }
}
