import type { ContentBlock } from "@agentclientprotocol/sdk";

// Re-export ACP types so consumers don't need a direct ACP SDK dependency
export type {
  ContentBlock,
  PromptCapabilities,
} from "@agentclientprotocol/sdk";

export type { ILogger } from "@my-cool-proxy/logger";

/**
 * Configuration for an ACP agent (stdio transport).
 */
export interface ACPAgentConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Result from an ACP prompt request.
 */
export interface ACPPromptResult {
  /** The accumulated content blocks from the agent response. */
  content: ContentBlock[];
  /** The stop reason returned by the agent (e.g., "end_turn", "max_tokens"). */
  stopReason: string;
}
