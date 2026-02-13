import type { ContentBlock } from "@agentclientprotocol/sdk";

// Re-export ACP types so consumers don't need a direct ACP SDK dependency
export type {
  ContentBlock,
  McpServer,
  McpServerStdio,
  EnvVariable,
  PromptCapabilities,
  ToolKind,
} from "@agentclientprotocol/sdk";

/**
 * Configuration for auto-approving ACP agent tool calls based on tool kind.
 * Allows fine-grained control over which tool categories are auto-approved.
 */
export interface AllowOwnToolsConfig {
  /**
   * DANGEROUS: Auto-approve ALL permission requests regardless of tool kind.
   * Supersedes toolKinds if set to true.
   * Default: false
   */
  dangerouslyAllowAll?: boolean;

  /**
   * List of tool kinds to auto-approve (e.g., ["read", "search", "think"]).
   * Valid values: read, edit, delete, move, search, execute, think, fetch, switch_mode, other
   * Default: [] (no auto-approval by kind)
   */
  toolKinds?: import("@agentclientprotocol/sdk").ToolKind[];
}

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

/**
 * Captured tool call from a sidecar tool.
 *
 * When an ACP agent attempts to call a sidecar tool (identified by tool tag),
 * the permission handler captures the tool call details instead of executing it.
 * This allows the sampling shim to return a tool_use response to the MCP server,
 * which is responsible for executing the tool per the MCP spec.
 */
export interface CapturedToolCall {
  /** Unique ID for this tool use (for correlation in multi-turn flow). */
  id: string;
  /** Original tool name (tag stripped). */
  name: string;
  /** Tool arguments/input. */
  input: Record<string, unknown>;
}

/**
 * Configuration for filesystem capabilities exposed to ACP agents.
 * Both options default to false for security.
 */
export interface FilesystemConfig {
  /** Enable reading text files within the session's working directory. */
  readTextFile: boolean;
  /** Enable writing text files within the session's working directory. */
  writeTextFile: boolean;
}

/**
 * Function type for looking up a session's working directory.
 * Returns the working directory path, or undefined if the session is unknown.
 */
export type WorkingDirectoryLookup = (sessionId: string) => string | undefined;
