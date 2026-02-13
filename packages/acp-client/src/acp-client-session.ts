import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { ACPPromptResult } from "./types.js";

/**
 * Function signature for sending a prompt via the ACP connection.
 */
export type PromptFunction = (
  sessionId: string,
  content: ContentBlock[],
) => Promise<{ stopReason: string }>;

/**
 * Function signature for registering a content block handler.
 */
export type RegisterHandlerFunction = (
  sessionId: string,
  handler: (block: ContentBlock) => void,
) => void;

/**
 * Function signature for deregistering a content block handler.
 */
export type DeregisterHandlerFunction = (sessionId: string) => void;

/**
 * Encapsulates a single ACP session's state.
 *
 * Each instance represents one short-lived ACP session (one per sampling request).
 * It registers a content block accumulator during prompt execution to collect
 * streaming content blocks from the agent, and deregisters on completion.
 */
export class ACPClientSession {
  constructor(
    private readonly sessionId: string,
    private readonly promptFn: PromptFunction,
    private readonly registerHandler: RegisterHandlerFunction,
    private readonly deregisterHandler: DeregisterHandlerFunction,
  ) {}

  /**
   * Send a prompt to the ACP agent and collect the response.
   *
   * Registers a content block accumulator for the duration of the prompt,
   * collects streaming content blocks, and returns the full result
   * once the agent completes.
   *
   * @param content Array of content blocks to send
   * @returns The accumulated content blocks and stop reason
   */
  async prompt(content: ContentBlock[]): Promise<ACPPromptResult> {
    const accumulatedContent: ContentBlock[] = [];

    this.registerHandler(this.sessionId, (block: ContentBlock) => {
      accumulatedContent.push(block);
    });

    try {
      const result = await this.promptFn(this.sessionId, content);
      return { content: accumulatedContent, stopReason: result.stopReason };
    } finally {
      this.deregisterHandler(this.sessionId);
    }
  }
}
