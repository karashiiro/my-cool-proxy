import type { IMCPClientManager, IMCPClientSession } from "../types.js";

/**
 * Result of a successful server lookup.
 */
export interface ServerLookupResult {
  /**
   * The resolved MCP client session.
   */
  client: IMCPClientSession;
  /**
   * Map of all available clients in the session.
   */
  clients: Map<string, IMCPClientSession>;
}

/**
 * Options for looking up a server.
 */
export interface ServerLookupOptions {
  /**
   * The server name to look up.
   */
  serverName: string;
  /**
   * The session ID to search in.
   */
  sessionId: string;
  /**
   * The client manager to use for lookup.
   */
  clientPool: IMCPClientManager;
}

/**
 * Looks up a server by name in the specified session.
 *
 * This centralizes the server lookup and error handling pattern used by
 * resource and prompt aggregation services.
 *
 * @param options - Options for the server lookup
 * @returns The client and all available clients if found
 * @throws Error if the server is not found, with list of available servers
 */
export function lookupServerOrThrow(
  options: ServerLookupOptions,
): ServerLookupResult {
  const { serverName, sessionId, clientPool } = options;
  const clients = clientPool.getClientsBySession(sessionId);
  const client = clients.get(serverName) as IMCPClientSession | undefined;

  if (!client) {
    const availableServers = Array.from(clients.keys()).join(", ");
    throw new Error(
      `Server '${serverName}' not found in session '${sessionId}'. Available servers: ${availableServers || "none"}`,
    );
  }

  return { client, clients };
}
