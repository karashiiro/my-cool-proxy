import { injectable } from "inversify";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import {
  ACPClient,
  type ACPAgentConfig,
  type McpServerStdio,
} from "@my-cool-proxy/acp-client";
import type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  ISamplingShim,
  ILogger,
  ICapabilityStore,
  IMCPClientManager,
} from "../types/interfaces.js";
import { mapMcpToAcpPrompt, mapAcpToMcpResult } from "../utils/index.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import { ToolCallbackServer } from "./tool-callback-server.js";

// Used to resolve the sidecar package path
const require = createRequire(import.meta.url);

/**
 * Provides sampling capability when the downstream client does not natively
 * support it, by routing sampling requests through a configured ACP agent.
 *
 * Thin orchestrator: all ACP protocol logic lives in @my-cool-proxy/acp-client,
 * all MCP<->ACP mapping lives in sampling-shim-mappers.ts.
 *
 * Lifecycle:
 * - One ACPClient per gateway session (long-lived agent process)
 * - One ACPClientSession per sampling request (short-lived, isolated)
 * - Working directory is determined by index.ts during initialization (roots or tempdir)
 */
@injectable()
export class SamplingShim implements ISamplingShim {
  private clients = new Map<string, ACPClient>();

  constructor(
    private readonly agentConfig: ACPAgentConfig,
    @$inject(TYPES.Logger) private readonly logger: ILogger,
    @$inject(TYPES.CapabilityStore)
    private readonly capabilityStore: ICapabilityStore,
    @$inject(TYPES.MCPClientManager)
    private readonly clientManager: IMCPClientManager,
  ) {}

  /**
   * Initialize the shim for a gateway session.
   * Spawns an ACP agent process and establishes a connection.
   * Working directory is determined by the caller (index.ts) and stored in CapabilityStore.
   */
  async initialize(sessionId: string): Promise<void> {
    if (this.clients.has(sessionId)) {
      throw new Error(
        `Sampling shim already initialized for session ${sessionId}`,
      );
    }

    this.logger.debug(`Initializing sampling shim for session ${sessionId}`);

    const client = new ACPClient(this.agentConfig, this.logger);
    await client.connect();
    this.clients.set(sessionId, client);

    this.logger.info(`Sampling shim initialized for session ${sessionId}`);
  }

  /**
   * Handle a sampling request by forwarding it through the ACP agent.
   * Creates a new ACP session for each request (short-lived, isolated).
   * Uses the working directory stored in CapabilityStore (client root or tempdir).
   *
   * If the request includes tools, sets up an ephemeral MCP sidecar to proxy
   * tool calls back to the gateway's upstream MCP servers.
   */
  async handleSamplingRequest(
    sessionId: string,
    params: CreateMessageRequest["params"],
  ): Promise<CreateMessageResult> {
    const client = this.clients.get(sessionId);
    const cwd = this.capabilityStore.getWorkingDirectory(sessionId);

    if (!client) {
      throw new Error(`Sampling shim not initialized for session ${sessionId}`);
    }

    if (!cwd) {
      throw new Error(
        `Working directory not initialized for session ${sessionId}`,
      );
    }

    let callbackServer: ToolCallbackServer | null = null;
    let mcpServers: McpServerStdio[] = [];
    let toolTag: string | undefined;

    // Set up tool proxy if tools are provided
    // No capability check needed - stdio MCP is required by ACP spec
    if (params.tools && params.tools.length > 0) {
      this.logger.debug(
        `Setting up tool sidecar for ${params.tools.length} tools`,
      );

      callbackServer = new ToolCallbackServer(
        this.clientManager,
        sessionId,
        this.logger,
      );
      const callbackUrl = await callbackServer.start();

      // Generate a unique tag for this session's tools
      // This tag is appended to tool names so we can identify them in permission requests
      toolTag = randomUUID().slice(0, 8);

      // Resolve the path to the compiled sidecar script
      // Note: We resolve the package directory and append the dist path explicitly
      // because require.resolve() doesn't work well with ESM exports
      const packageDir =
        require.resolve("@my-cool-proxy/mcp-sampling-sidecar/package.json");
      const sidecarPath = packageDir.replace("/package.json", "/dist/index.js");

      mcpServers = [
        {
          name: "sampling-tools",
          command: "node",
          args: [sidecarPath],
          env: [
            { name: "CALLBACK_URL", value: callbackUrl },
            { name: "TOOLS_JSON", value: JSON.stringify(params.tools) },
            { name: "TOOL_TAG", value: toolTag },
          ],
        },
      ];
    }

    try {
      // Map MCP sampling params to ACP prompt content,
      // respecting the agent's advertised prompt capabilities
      const acpContent = mapMcpToAcpPrompt(params, client.promptCapabilities);

      // Create a new ACP session for this request with the stored cwd,
      // optional MCP servers for tool support, and tool tag for permission matching
      const session = await client.createSession(cwd, mcpServers, toolTag);

      // Send the prompt and get the result
      const acpResult = await session.prompt(acpContent);

      // Map ACP result back to MCP format
      return mapAcpToMcpResult(acpResult.content, acpResult.stopReason);
    } finally {
      // Always clean up the callback server
      if (callbackServer) {
        await callbackServer.stop();
      }
    }
  }

  /**
   * Close the shim for a specific session.
   * Kills the ACP agent process. Tempdir cleanup is handled by the caller (index.ts).
   */
  async close(sessionId: string): Promise<void> {
    const client = this.clients.get(sessionId);

    if (client) {
      this.logger.debug(`Closing sampling shim for session ${sessionId}`);
      await client.close();
      this.clients.delete(sessionId);
    }
  }

  /**
   * Close all active shim sessions.
   */
  async closeAll(): Promise<void> {
    this.logger.debug(
      `Closing all sampling shim sessions (${this.clients.size} active)`,
    );

    const closePromises = Array.from(this.clients.entries()).map(
      async ([sessionId, client]) => {
        try {
          await client.close();
        } catch (error) {
          this.logger.error(
            `Error closing shim for session ${sessionId}`,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      },
    );

    await Promise.all(closePromises);
    this.clients.clear();
  }
}
