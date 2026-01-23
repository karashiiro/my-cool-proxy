import "reflect-metadata";
import { serveHttp, type ServerHandle } from "@karashiiro/mcp/http";
import { createContainer } from "../../container/inversify.config.js";
import { TYPES } from "../../types/index.js";
import type {
  ILogger,
  IMCPClientManager,
  ICapabilityStore,
  ServerConfig,
  MCPClientConfig,
  DownstreamCapabilities,
} from "../../types/interfaces.js";
import { MCPGatewayServer } from "../../mcp/gateway-server.js";
import type {
  ResourceAggregationService,
  PromptAggregationService,
} from "@my-cool-proxy/mcp-aggregation";
import type { IToolRegistry } from "../../tools/tool-registry.js";
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export class HttpServerManager {
  private serverHandle: ServerHandle | null = null;
  private clientManager: IMCPClientManager | null = null;

  /**
   * Starts the HTTP gateway server with the provided configuration.
   *
   * @param config - Server configuration
   */
  async start(config: ServerConfig): Promise<void> {
    if (this.serverHandle) {
      throw new Error("Server is already running");
    }

    if (!config.port || !config.host) {
      throw new Error("Port and host are required for HTTP mode");
    }

    // Create DI container
    const container = createContainer(config);

    const logger = container.get<ILogger>(TYPES.Logger);

    // Store client manager for cleanup
    this.clientManager = container.get<IMCPClientManager>(
      TYPES.MCPClientManager,
    );

    // Get shared services from container
    const toolRegistry = container.get<IToolRegistry>(TYPES.ToolRegistry);
    const resourceAggregation = container.get<ResourceAggregationService>(
      TYPES.ResourceAggregationService,
    );
    const promptAggregation = container.get<PromptAggregationService>(
      TYPES.PromptAggregationService,
    );

    const clientManager = this.clientManager;
    const capabilityStore = container.get<ICapabilityStore>(
      TYPES.CapabilityStore,
    );

    // Use @karashiiro/mcp's serveHttp with session-aware factory
    this.serverHandle = await serveHttp(
      async (sessionId) => {
        // Create gateway server FIRST (before upstream clients)
        // This allows us to capture downstream client capabilities during initialization
        const gatewayServer = new MCPGatewayServer(
          toolRegistry,
          clientManager,
          logger,
          resourceAggregation,
          promptAggregation,
        );

        // Set up callback to initialize upstream clients when downstream client connects
        // This ensures we forward the correct capabilities to upstream servers
        gatewayServer.setOnDownstreamInitialized(async (capabilities) => {
          logger.debug(
            `Session ${sessionId}: Downstream client initialized with capabilities: ` +
              `sampling=${!!capabilities.sampling}, elicitation=${!!capabilities.elicitation}`,
          );

          // Store capabilities for this session
          capabilityStore.setCapabilities(sessionId, capabilities);

          // Initialize upstream MCP clients with the downstream capabilities
          await initializeClientsForSession(
            sessionId,
            config,
            clientManager,
            capabilities,
          );

          // Register proxy handlers for sampling/elicitation forwarding
          registerProxyHandlers(
            sessionId,
            clientManager,
            gatewayServer,
            logger,
            capabilities,
          );
        });

        return gatewayServer.getServer();
      },
      {
        port: config.port,
        host: config.host,
        sessions: {
          onSessionClosed: async (sessionId) => {
            try {
              await clientManager.closeSession(sessionId);
              capabilityStore.deleteCapabilities(sessionId);
            } catch {
              // Ignore cleanup errors
            }
          },
        },
      },
    );

    logger.info(
      `Test MCP Gateway started on http://${config.host}:${config.port}`,
    );

    // Wait for server to be ready
    await this.waitForReady(config.host, config.port);
  }

  /**
   * Stops the HTTP gateway server.
   */
  async stop(): Promise<void> {
    if (this.serverHandle) {
      await this.serverHandle.close();
      this.serverHandle = null;
    }

    if (this.clientManager) {
      await this.clientManager.close();
      this.clientManager = null;
    }
  }

  /**
   * Waits for the server to be ready by checking if the port is listening.
   */
  private async waitForReady(
    host: string,
    port: number,
    timeoutMs = 5000,
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Try to connect to the server - just check if port is open
        const net = await import("node:net");
        const socket = new net.Socket();

        await new Promise<void>((resolve, reject) => {
          socket.setTimeout(1000);
          socket.once("connect", () => {
            socket.destroy();
            resolve();
          });
          socket.once("timeout", () => {
            socket.destroy();
            reject(new Error("Timeout"));
          });
          socket.once("error", (err) => {
            reject(err);
          });
          socket.connect(port, host);
        });

        // Server is ready
        return;
      } catch {
        // Server not ready yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    throw new Error(`Server did not become ready within ${timeoutMs}ms`);
  }
}

/**
 * Register sampling and elicitation request handlers on upstream clients.
 * These handlers forward requests from upstream servers to the downstream client
 * via the gateway server.
 */
function registerProxyHandlers(
  sessionId: string,
  clientManager: IMCPClientManager,
  gatewayServer: MCPGatewayServer,
  logger: ILogger,
  capabilities: DownstreamCapabilities,
): void {
  const clients = clientManager.getClientsBySession(sessionId);

  for (const [serverName, clientSession] of clients) {
    // Register sampling handler if downstream supports it
    if (capabilities.sampling) {
      clientSession.setRequestHandler(
        CreateMessageRequestSchema,
        async (request) => {
          logger.debug(
            `Received sampling request from upstream server '${serverName}', forwarding to downstream`,
          );
          try {
            const result = await gatewayServer.forwardSamplingRequest(
              request.params,
            );
            return result;
          } catch (error) {
            logger.error(
              `Failed to forward sampling request from '${serverName}'`,
              error instanceof Error ? error : new Error(String(error)),
            );
            throw error;
          }
        },
      );
      logger.debug(
        `Registered sampling request handler for upstream server '${serverName}'`,
      );
    }

    // Register elicitation handler if downstream supports it
    if (capabilities.elicitation) {
      clientSession.setRequestHandler(ElicitRequestSchema, async (request) => {
        logger.debug(
          `Received elicitation request from upstream server '${serverName}', forwarding to downstream`,
        );
        try {
          const result = await gatewayServer.forwardElicitationRequest(
            request.params,
          );
          return result;
        } catch (error) {
          logger.error(
            `Failed to forward elicitation request from '${serverName}'`,
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      });
      logger.debug(
        `Registered elicitation request handler for upstream server '${serverName}'`,
      );
    }
  }

  const clientCount = clients.size;
  if (capabilities.sampling || capabilities.elicitation) {
    logger.info(
      `Registered proxy handlers on ${clientCount} upstream client(s): ` +
        `sampling=${!!capabilities.sampling}, elicitation=${!!capabilities.elicitation}`,
    );
  }
}

/**
 * Initialize MCP clients for a given session.
 * This is called when a new session is created in HTTP mode.
 */
async function initializeClientsForSession(
  sessionId: string,
  config: ServerConfig,
  clientManager: IMCPClientManager,
  capabilities?: DownstreamCapabilities,
): Promise<void> {
  const initPromises: Promise<void>[] = [];

  for (const [name, clientConfig] of Object.entries(config.mcpClients)) {
    initPromises.push(
      initializeSingleClient(
        name,
        clientConfig,
        sessionId,
        clientManager,
        capabilities,
      ),
    );
  }

  await Promise.all(initPromises);
}

/**
 * Initialize a single MCP client.
 */
async function initializeSingleClient(
  name: string,
  clientConfig: MCPClientConfig,
  sessionId: string,
  clientManager: IMCPClientManager,
  capabilities?: DownstreamCapabilities,
): Promise<void> {
  if (clientConfig.type === "http") {
    await clientManager.addHttpClient(
      name,
      clientConfig.url,
      sessionId,
      clientConfig.headers,
      clientConfig.allowedTools,
      capabilities,
    );
  } else if (clientConfig.type === "stdio") {
    await clientManager.addStdioClient(
      name,
      clientConfig.command,
      sessionId,
      clientConfig.args,
      clientConfig.env,
      clientConfig.allowedTools,
      capabilities,
    );
  }
}
