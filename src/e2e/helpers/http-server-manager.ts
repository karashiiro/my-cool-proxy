import "reflect-metadata";
import { serveHttp, type ServerHandle } from "@karashiiro/mcp/http";
import { createContainer } from "../../container/inversify.config.js";
import { TYPES } from "../../types/index.js";
import type {
  ILogger,
  IMCPClientManager,
  ServerConfig,
  MCPClientConfig,
} from "../../types/interfaces.js";
import { MCPGatewayServer } from "../../mcp/gateway-server.js";
import type { ResourceAggregationService } from "../../mcp/resource-aggregation-service.js";
import type { PromptAggregationService } from "../../mcp/prompt-aggregation-service.js";
import type { IToolRegistry } from "../../tools/tool-registry.js";

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

    // Use @karashiiro/mcp's serveHttp with session-aware factory
    this.serverHandle = await serveHttp(
      async (sessionId) => {
        // Initialize MCP clients for this session
        await initializeClientsForSession(sessionId, config, clientManager);

        // Create gateway server for this session
        const gatewayServer = new MCPGatewayServer(
          toolRegistry,
          clientManager,
          logger,
          resourceAggregation,
          promptAggregation,
        );

        return gatewayServer.getServer();
      },
      {
        port: config.port,
        host: config.host,
        sessions: {},
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
 * Initialize MCP clients for a given session.
 * This is called when a new session is created in HTTP mode.
 */
async function initializeClientsForSession(
  sessionId: string,
  config: ServerConfig,
  clientManager: IMCPClientManager,
): Promise<void> {
  const initPromises: Promise<void>[] = [];

  for (const [name, clientConfig] of Object.entries(config.mcpClients)) {
    initPromises.push(
      initializeSingleClient(name, clientConfig, sessionId, clientManager),
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
): Promise<void> {
  if (clientConfig.type === "http") {
    await clientManager.addHttpClient(
      name,
      clientConfig.url,
      sessionId,
      clientConfig.headers,
      clientConfig.allowedTools,
    );
  } else if (clientConfig.type === "stdio") {
    await clientManager.addStdioClient(
      name,
      clientConfig.command,
      sessionId,
      clientConfig.args,
      clientConfig.env,
      clientConfig.allowedTools,
    );
  }
}
