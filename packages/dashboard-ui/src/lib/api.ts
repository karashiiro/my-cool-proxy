import type { LuaExecution, LuaToolCall } from "./types.js";

/** Paginated response from the executions endpoint. */
export interface ExecutionsPage {
  executions: LuaExecution[];
  total: number;
}

/** A tool name with its usage count. */
export interface ToolUsage {
  tool: string;
  count: number;
}

/**
 * Fetch a page of executions from the dashboard API.
 */
export async function fetchExecutions(
  limit = 50,
  offset = 0,
  tool?: string | null,
): Promise<ExecutionsPage> {
  let url = `/api/executions?limit=${limit}&offset=${offset}`;
  if (tool) url += `&tool=${encodeURIComponent(tool)}`;
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`Failed to fetch executions: ${res.statusText}`);
  return res.json();
}

/**
 * Fetch distinct tool names with usage counts, ordered by count descending.
 */
export async function fetchTools(): Promise<ToolUsage[]> {
  const res = await fetch("/api/tools");
  if (!res.ok)
    throw new Error(`Failed to fetch tools: ${res.statusText}`);
  return res.json();
}

/**
 * Fetch a single execution by ID.
 */
export async function fetchExecution(id: string): Promise<LuaExecution> {
  const res = await fetch(`/api/executions/${encodeURIComponent(id)}`);
  if (!res.ok)
    throw new Error(`Failed to fetch execution: ${res.statusText}`);
  return res.json();
}

/**
 * Fetch tool calls for a given execution.
 */
export async function fetchToolCalls(
  executionId: string,
): Promise<LuaToolCall[]> {
  const res = await fetch(
    `/api/executions/${encodeURIComponent(executionId)}/tool-calls`,
  );
  if (!res.ok)
    throw new Error(`Failed to fetch tool calls: ${res.statusText}`);
  return res.json();
}

/** Session info returned by the sessions API. */
export interface SessionInfo {
  sessionId: string;
  createdAt: number;
  lastActivity: number;
  capabilities: { sampling: boolean; elicitation: boolean; roots: boolean };
  workingDirectory: string | null;
  connectedServers: string[];
  failedServers: Array<{ name: string; error: string }>;
}

/**
 * Fetch active sessions with their server connections and capabilities.
 */
export async function fetchSessions(): Promise<SessionInfo[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok)
    throw new Error(`Failed to fetch sessions: ${res.statusText}`);
  return res.json();
}
