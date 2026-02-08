import { injectable } from "inversify";
import { ACPClient, type ACPAgentConfig } from "@my-cool-proxy/acp-client";
import type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { ISamplingPonyfill, ILogger } from "../types/interfaces.js";
import {
  mapMcpToAcpPrompt,
  mapAcpToMcpResult,
} from "../utils/mcp-acp-mappers.js";

/**
 * Provides sampling capability when the downstream client does not natively
 * support it, by routing sampling requests through a configured ACP agent.
 *
 * Thin orchestrator: all ACP protocol logic lives in @my-cool-proxy/acp-client,
 * all MCP<->ACP mapping lives in sampling-ponyfill-mappers.ts.
 *
 * Lifecycle:
 * - One ACPClient per gateway session (long-lived agent process)
 * - One ACPClientSession per sampling request (short-lived, isolated)
 */
@injectable()
export class SamplingPonyfill implements ISamplingPonyfill {
  private clients = new Map<string, ACPClient>();

  constructor(
    private readonly agentConfig: ACPAgentConfig,
    private readonly logger: ILogger,
  ) {}

  /**
   * Initialize the ponyfill for a gateway session.
   * Spawns an ACP agent process and establishes a connection.
   */
  async initialize(sessionId: string): Promise<void> {
    if (this.clients.has(sessionId)) {
      throw new Error(
        `Sampling ponyfill already initialized for session ${sessionId}`,
      );
    }

    this.logger.debug(
      `Initializing sampling ponyfill for session ${sessionId}`,
    );

    const client = new ACPClient(this.agentConfig, this.logger);
    await client.connect();
    this.clients.set(sessionId, client);

    this.logger.info(`Sampling ponyfill initialized for session ${sessionId}`);
  }

  /**
   * Handle a sampling request by forwarding it through the ACP agent.
   * Creates a new ACP session for each request (short-lived, isolated).
   */
  async handleSamplingRequest(
    sessionId: string,
    params: CreateMessageRequest["params"],
  ): Promise<CreateMessageResult> {
    const client = this.clients.get(sessionId);
    if (!client) {
      throw new Error(
        `Sampling ponyfill not initialized for session ${sessionId}`,
      );
    }

    // Map MCP sampling params to ACP prompt content,
    // respecting the agent's advertised prompt capabilities
    const acpContent = mapMcpToAcpPrompt(params, client.promptCapabilities);

    // Create a new ACP session for this request
    const session = await client.createSession();

    // Send the prompt and get the result
    const acpResult = await session.prompt(acpContent);

    // Map ACP result back to MCP format
    return mapAcpToMcpResult(acpResult.content, acpResult.stopReason);
  }

  /**
   * Close the ponyfill for a specific session.
   * Kills the ACP agent process and cleans up.
   */
  async close(sessionId: string): Promise<void> {
    const client = this.clients.get(sessionId);
    if (client) {
      this.logger.debug(`Closing sampling ponyfill for session ${sessionId}`);
      await client.close();
      this.clients.delete(sessionId);
    }
  }

  /**
   * Close all active ponyfill sessions.
   */
  async closeAll(): Promise<void> {
    this.logger.debug(
      `Closing all sampling ponyfill sessions (${this.clients.size} active)`,
    );

    const closePromises = Array.from(this.clients.entries()).map(
      async ([sessionId, client]) => {
        try {
          await client.close();
        } catch (error) {
          this.logger.error(
            `Error closing ponyfill for session ${sessionId}`,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      },
    );

    await Promise.all(closePromises);
    this.clients.clear();
  }
}
