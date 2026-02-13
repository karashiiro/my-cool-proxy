import "reflect-metadata";
import { serveHttp, type ServerHandle } from "@karashiiro/mcp/http";
import { createContainer } from "../../container/inversify.config.js";
import { TYPES } from "../../types/index.js";
import type {
  ILogger,
  IMCPClientManager,
  ICapabilityStore,
  ISamplingShim,
  ServerConfig,
  MCPClientConfig,
  ClientCapabilities,
} from "../../types/interfaces.js";
import { MCPGatewayServer } from "../../mcp/gateway-server.js";
import { registerProxyHandlers } from "../../handlers/proxy-handlers.js";
import type {
  ResourceAggregationService,
  PromptAggregationService,
} from "@my-cool-proxy/mcp-aggregation";
import type { IToolRegistry } from "../../tools/tool-registry.js";
import {
  createSessionTempDir,
  cleanupSessionTempDir,
  initializeSamplingShim,
} from "../../utils/index.js";

export class HttpServerManager {
  private serverHandle: ServerHandle | null = null;
  private clientManager: IMCPClientManager | null = null;
  private samplingShim: ISamplingShim | null = null;

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

    // Resolve the sampling shim from the container if bound
    const samplingShim = container.isBound(TYPES.SamplingShim)
      ? container.get<ISamplingShim>(TYPES.SamplingShim)
      : undefined;
    this.samplingShim = samplingShim ?? null;

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

          // Create session-isolated tempdir for sampling shim
          // Note: roots/list is currently broken in the TS SDK, so we always use tempdir
          const workingDirectory = createSessionTempDir(sessionId);
          logger.info(
            `Session ${sessionId}: Using tempdir as cwd: ${workingDirectory}`,
          );

          // Store working directory BEFORE initializing shim
          capabilityStore.setWorkingDirectory(sessionId, workingDirectory);

          // Initialize sampling shim if needed (when client lacks full sampling capability)
          const { activeShim, upstreamCapabilities } =
            await initializeSamplingShim(
              sessionId,
              capabilities,
              samplingShim,
              logger,
            );

          // Initialize upstream MCP clients with the (possibly augmented) capabilities
          await initializeClientsForSession(
            sessionId,
            config,
            clientManager,
            upstreamCapabilities,
          );

          // Register proxy handlers for sampling/elicitation forwarding
          registerProxyHandlers(
            sessionId,
            clientManager,
            gatewayServer,
            logger,
            capabilities,
            activeShim,
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

              // Clean up working directory if it's a tempdir
              const workingDir = capabilityStore.getWorkingDirectory(sessionId);
              if (workingDir && workingDir.includes("mcp-gateway-")) {
                cleanupSessionTempDir(workingDir);
              }

              capabilityStore.deleteCapabilities(sessionId);
              if (samplingShim) {
                await samplingShim.close(sessionId);
              }
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

    if (this.samplingShim) {
      await this.samplingShim.closeAll();
      this.samplingShim = null;
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
  capabilities?: ClientCapabilities,
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
  capabilities?: ClientCapabilities,
): Promise<void> {
  if (clientConfig.type === "http") {
    await clientManager.addHttpClient(
      name,
      clientConfig.url,
      sessionId,
      clientConfig.headers,
      clientConfig.allowedTools,
      capabilities,
      clientConfig.dangerouslyEnableSampling,
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
      undefined, // stderrLogPath - not used in e2e tests
      clientConfig.dangerouslyEnableSampling,
    );
  }
}
