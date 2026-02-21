/**
 * A logged Lua script execution (mirrors gateway's LuaExecution type).
 */
export interface LuaExecution {
  executionId: string;
  sessionId: string;
  script: string;
  status: "success" | "error";
  error?: string | null;
  result?: string | null;
  createdAt: number;
}

/**
 * A logged tool call made within a Lua script execution.
 */
export interface LuaToolCall {
  callId: string;
  executionId: string;
  serverName: string;
  toolName: string;
  arguments?: string | null;
  status: "success" | "error";
  error?: string | null;
  result?: string | null;
  createdAt: number;
}
