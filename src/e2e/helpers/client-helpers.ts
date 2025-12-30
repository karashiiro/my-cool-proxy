import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Configuration for creating an MCP test client
 */
export interface ClientConfig {
  /** Port of the gateway server */
  gatewayPort: number;
  /** Session ID for this client */
  sessionId: string;
  /** Optional client name (defaults to session ID) */
  clientName?: string;
}

/**
 * Creates and connects an MCP client to the gateway.
 * Returns both the client and transport for cleanup.
 */
export async function createGatewayClient(
  config: ClientConfig,
): Promise<Client> {
  const client = new Client(
    {
      name: config.clientName || `client-${config.sessionId}`,
      version: "1.0.0",
    },
    { capabilities: {} },
  );

  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${config.gatewayPort}/mcp`),
    {
      requestInit: {
        headers: {
          "mcp-session-id": config.sessionId,
        },
      },
    },
  );

  await client.connect(transport);
  return client;
}

/**
 * Creates multiple clients with different session IDs.
 * Useful for multi-session testing.
 */
export async function createMultipleClients(
  gatewayPort: number,
  sessionIds: string[],
): Promise<Client[]> {
  return Promise.all(
    sessionIds.map((sessionId) =>
      createGatewayClient({ gatewayPort, sessionId }),
    ),
  );
}

/**
 * Closes multiple clients safely (ignoring errors).
 */
export async function closeClients(
  clients: Array<Client | undefined>,
): Promise<void> {
  await Promise.all(
    clients.filter(Boolean).map(async (client) => {
      try {
        await client!.close();
      } catch {
        // Ignore cleanup errors
      }
    }),
  );
}
