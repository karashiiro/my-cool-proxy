import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

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

  // Wait for upstream servers to be ready by polling list-servers
  // This is necessary because upstream clients are created asynchronously
  // after the downstream client's capabilities are captured
  await waitForServersReady(client);

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

/**
 * Configuration for creating a client with sampling/elicitation capabilities
 */
export interface CapableClientConfig extends ClientConfig {
  /** Whether to enable sampling capability */
  sampling?: boolean;
  /** Whether to enable elicitation capability */
  elicitation?: boolean;
  /** Mock response for sampling requests */
  mockSamplingResponse?: string;
  /** Mock response content for elicitation requests */
  mockElicitationResponse?: Record<string, unknown>;
  /** Mock elicitation action (accept/decline/cancel) */
  mockElicitationAction?: "accept" | "decline" | "cancel";
}

/**
 * Creates a client that advertises and handles sampling/elicitation capabilities.
 * This is useful for testing the sampling/elicitation proxy functionality.
 *
 * The client will register handlers that respond with mock data, allowing
 * upstream servers to send sampling/elicitation requests through the proxy.
 */
export async function createCapableGatewayClient(
  config: CapableClientConfig,
): Promise<Client> {
  const capabilities: Record<string, unknown> = {};

  if (config.sampling) {
    capabilities.sampling = {};
  }

  if (config.elicitation) {
    capabilities.elicitation = {
      form: {},
    };
  }

  const client = new Client(
    {
      name: config.clientName || "capable-test-client",
      version: "1.0.0",
    },
    { capabilities },
  );

  // Register sampling handler if enabled
  if (config.sampling) {
    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      // Extract the question from the first message
      const firstMessage = request.params.messages[0];
      let questionText = "unknown question";
      if (firstMessage?.content) {
        if (typeof firstMessage.content === "string") {
          questionText = firstMessage.content;
        } else if (
          "type" in firstMessage.content &&
          firstMessage.content.type === "text"
        ) {
          questionText = firstMessage.content.text;
        }
      }

      // Return mock LLM response
      const responseText =
        config.mockSamplingResponse || `Mock LLM response to: ${questionText}`;

      return {
        role: "assistant",
        content: {
          type: "text",
          text: responseText,
        },
        model: "mock-model",
        stopReason: "endTurn",
      };
    });
  }

  // Register elicitation handler if enabled
  if (config.elicitation) {
    client.setRequestHandler(ElicitRequestSchema, async () => {
      const action = config.mockElicitationAction || "accept";

      if (action === "accept") {
        return {
          action: "accept" as const,
          content: config.mockElicitationResponse || {
            response: "test-user-input",
          },
        };
      } else {
        return {
          action: action as "decline" | "cancel",
        };
      }
    });
  }

  // Connect to the gateway
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${config.gatewayPort}/mcp`),
  );

  await client.connect(transport);

  // Wait for upstream servers to be ready by polling list-servers
  // This is necessary because upstream clients are created asynchronously
  // after the downstream client's capabilities are captured
  await waitForServersReady(client);

  return client;
}

/**
 * Waits for upstream servers to be available by polling list-servers.
 * This is necessary because upstream MCP clients are created asynchronously
 * after the downstream client connects and its capabilities are captured.
 */
async function waitForServersReady(
  client: Client,
  timeoutMs = 5000,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = await client.callTool({
        name: "list-servers",
        arguments: {},
      });

      // Check if servers are available
      const content = result.content as Array<{ type: string; text?: string }>;
      const firstContent = content[0];
      if (firstContent && "text" in firstContent && firstContent.text) {
        const text = firstContent.text;
        // If we see "Available MCP Servers: X" where X > 0, servers are ready
        const match = text.match(/Available MCP Servers: (\d+)/);
        if (match && match[1] && parseInt(match[1], 10) > 0) {
          return;
        }
      }
    } catch {
      // Ignore errors during polling
    }

    // Wait a bit before retrying
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Servers did not become ready within ${timeoutMs}ms`);
}
