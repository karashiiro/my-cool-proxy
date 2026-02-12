import { sanitizeLuaIdentifier } from "@my-cool-proxy/mcp-utilities";
import type { IMCPClientSession } from "../types.js";

/**
 * Options for formatting a server not found error.
 */
export interface ServerNotFoundErrorOptions {
  /**
   * The server name that was not found.
   */
  serverName: string;
  /**
   * Map of available MCP clients to extract server names from.
   */
  clients: Map<string, IMCPClientSession>;
  /**
   * Optional session ID to include in the error message.
   */
  sessionId?: string;
  /**
   * Whether to use Lua-sanitized identifiers for available servers.
   * @default true
   */
  useLuaIdentifiers?: boolean;
}

/**
 * Formats a server list from client map keys.
 *
 * @param clients - Map of client names to sessions
 * @param useLuaIdentifiers - Whether to sanitize names to Lua identifiers
 * @returns Comma-separated server list or "none"
 */
export function formatServerList(
  clients: Map<string, IMCPClientSession>,
  useLuaIdentifiers = true,
): string {
  const serverNames = Array.from(clients.keys());
  if (serverNames.length === 0) {
    return "none";
  }
  if (useLuaIdentifiers) {
    return serverNames.map((name) => sanitizeLuaIdentifier(name)).join(", ");
  }
  return serverNames.join(", ");
}

/**
 * Formats a consistent "server not found" error message.
 *
 * This centralizes the error message format across tool discovery and
 * aggregation services to ensure users see consistent error messages.
 *
 * @param options - Options for formatting the error
 * @returns Formatted error message string
 */
export function formatServerNotFoundError(
  options: ServerNotFoundErrorOptions,
): string {
  const { serverName, clients, sessionId, useLuaIdentifiers = true } = options;
  const serverList = formatServerList(clients, useLuaIdentifiers);

  if (sessionId) {
    return `Server '${serverName}' not found in session '${sessionId}'.\n\nAvailable servers: ${serverList}`;
  }

  return `Server '${serverName}' not found.\n\nAvailable servers: ${serverList}`;
}
