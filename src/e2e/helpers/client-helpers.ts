import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Configuration for creating an MCP test client
 */
export interface ClientConfig {
  /** Port of the gateway server */
  gatewayPort: number;
  /** Optional client name */
  clientName?: string;
}

/**
 * Creates and connects an MCP client to the gateway.
 * Session management is handled automatically by the MCP protocol.
 * Returns the connected client.
 */
export async function createGatewayClient(
  config: ClientConfig,
): Promise<Client> {
  const client = new Client(
    {
      name: config.clientName || "test-client",
      version: "1.0.0",
    },
    { capabilities: {} },
  );

  // Let the MCP SDK handle session negotiation automatically
  // No need to provide a session ID - the server generates one
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${config.gatewayPort}/mcp`),
  );

  await client.connect(transport);
  return client;
}

/**
 * Creates multiple clients, each with their own session.
 * Each client will get a unique server-generated session ID.
 * Useful for multi-session testing.
 */
export async function createMultipleClients(
  gatewayPort: number,
  count: number,
): Promise<Client[]> {
  return Promise.all(
    Array.from({ length: count }, (_, i) =>
      createGatewayClient({
        gatewayPort,
        clientName: `multi-client-${i + 1}`,
      }),
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
