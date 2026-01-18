import "reflect-metadata";
import type { TypedContainer } from "@inversifyjs/strongly-typed";
import { createContainer } from "./container/inversify.config.js";
import type { ContainerBindingMap } from "./container/binding-map.js";
import { TYPES } from "./types/index.js";
import type {
  ClientConnectionResult,
  ILogger,
  IMCPClientManager,
  IShutdownHandler,
  ServerConfig,
} from "./types/interfaces.js";
import { serveHttp } from "@karashiiro/mcp/http";
import { serveStdio } from "@karashiiro/mcp/stdio";
import { loadConfig, mergeEnvConfig } from "./utils/config-loader.js";
import { MCPGatewayServer } from "./mcp/gateway-server.js";
import type { IToolRegistry } from "./tools/tool-registry.js";
import type { ResourceAggregationService } from "./mcp/resource-aggregation-service.js";
import type { PromptAggregationService } from "./mcp/prompt-aggregation-service.js";

// Load configuration from file and merge with environment variables
const config = mergeEnvConfig(loadConfig());

interface InitializationResult {
  successful: string[];
  failed: Array<{ name: string; error: string }>;
}

/**
 * Initialize MCP clients for a given session.
 * Uses Promise.allSettled to connect to all servers in parallel and continue
 * even if some fail.
 */
async function initializeClientsForSession(
  sessionId: string,
  config: ServerConfig,
  clientManager: IMCPClientManager,
): Promise<InitializationResult> {
  const connectionPromises = Object.entries(config.mcpClients).map(
    async ([name, clientConfig]): Promise<ClientConnectionResult> => {
      if (clientConfig.type === "http") {
        return clientManager.addHttpClient(
          name,
          clientConfig.url,
          sessionId,
          clientConfig.headers,
          clientConfig.allowedTools,
        );
      } else if (clientConfig.type === "stdio") {
        return clientManager.addStdioClient(
          name,
          clientConfig.command,
          sessionId,
          clientConfig.args,
          clientConfig.env,
          clientConfig.allowedTools,
        );
      } else {
        // Exhaustiveness check - TypeScript will error if a new type is added
        // but not handled above
        const _exhaustiveCheck: never = clientConfig;
        return {
          name,
          success: false,
          error: `Unknown client type: ${(_exhaustiveCheck as { type: string }).type}`,
        };
      }
    },
  );

  const results = await Promise.allSettled(connectionPromises);

  const successful: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      if (result.value.success) {
        successful.push(result.value.name);
      } else {
        failed.push({
          name: result.value.name,
          error: result.value.error || "Unknown error",
        });
      }
    } else {
      // Promise rejection (shouldn't happen with our try-catch, but safety)
      // Handle both Error objects and non-Error rejections
      const errorMessage =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason ?? "Unknown rejection");
      failed.push({
        name: "unknown",
        error: errorMessage,
      });
    }
  }

  return { successful, failed };
}

async function startHttpMode(
  container: TypedContainer<ContainerBindingMap>,
  config: ServerConfig,
) {
  const logger = container.get<ILogger>(TYPES.Logger);

  // Ensure port and host are defined (validation should guarantee this)
  if (config.port === undefined || config.host === undefined) {
    throw new Error("Port and host are required for HTTP mode");
  }

  // Get shared services from DI container
  const clientManager = container.get<IMCPClientManager>(
    TYPES.MCPClientManager,
  );
  const toolRegistry = container.get<IToolRegistry>(TYPES.ToolRegistry);
  const resourceAggregation = container.get<ResourceAggregationService>(
    TYPES.ResourceAggregationService,
  );
  const promptAggregation = container.get<PromptAggregationService>(
    TYPES.PromptAggregationService,
  );
  const shutdownHandler = container.get<IShutdownHandler>(
    TYPES.ShutdownHandler,
  );

  // Start HTTP server with per-session factory
  const handle = await serveHttp(
    async (sessionId) => {
      logger.info(`Creating gateway server for session ${sessionId}`);

      // Initialize MCP clients for this session (resilient - continues even if some fail)
      const initResult = await initializeClientsForSession(
        sessionId,
        config,
        clientManager,
      );

      if (initResult.failed.length > 0) {
        logger.warn(
          `Session ${sessionId}: ${initResult.failed.length} server(s) failed to connect: ` +
            initResult.failed.map((f) => `${f.name} (${f.error})`).join(", "),
        );
      }

      if (
        initResult.successful.length === 0 &&
        Object.keys(config.mcpClients).length > 0
      ) {
        logger.warn(
          `Session ${sessionId}: All configured servers failed to connect. Session created but no servers available.`,
        );
      }

      logger.info(
        `Session ${sessionId}: ${initResult.successful.length} server(s) connected successfully`,
      );

      // Create new gateway server instance for this session
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
      sessions: {
        // Clean up session-scoped state when sessions are closed
        onSessionClosed: async (sessionId) => {
          logger.debug(`Session ${sessionId} closed, cleaning up...`);
          try {
            await clientManager.closeSession(sessionId);
          } catch (error) {
            // Log but don't re-throw - ensure callback doesn't fail the cleanup
            logger.error(
              `Failed to close session ${sessionId}`,
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        },
      },
    },
  );

  logger.info(
    `MCP Lua Gateway listening on http://${config.host}:${config.port}`,
  );

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await handle.close();
    await shutdownHandler.shutdown();
  });
}

async function startStdioMode(
  container: TypedContainer<ContainerBindingMap>,
  config: ServerConfig,
) {
  const logger = container.get<ILogger>(TYPES.Logger);
  const clientManager = container.get<IMCPClientManager>(
    TYPES.MCPClientManager,
  );
  const toolRegistry = container.get<IToolRegistry>(TYPES.ToolRegistry);
  const resourceAggregation = container.get<ResourceAggregationService>(
    TYPES.ResourceAggregationService,
  );
  const promptAggregation = container.get<PromptAggregationService>(
    TYPES.PromptAggregationService,
  );

  // Fixed session ID for stdio (single session mode)
  const SESSION_ID = "default";

  // Initialize all configured MCP clients upfront (resilient - continues even if some fail)
  const initResult = await initializeClientsForSession(
    SESSION_ID,
    config,
    clientManager,
  );

  if (initResult.failed.length > 0) {
    logger.warn(
      `${initResult.failed.length} server(s) failed to connect: ` +
        initResult.failed.map((f) => `${f.name} (${f.error})`).join(", "),
    );
  }

  if (
    initResult.successful.length === 0 &&
    Object.keys(config.mcpClients).length > 0
  ) {
    logger.warn(
      `All configured servers failed to connect. Gateway starting but no servers available.`,
    );
  }

  logger.info(
    `${initResult.successful.length} server(s) connected successfully`,
  );

  // Start stdio server
  const handle = await serveStdio(() => {
    const gatewayServer = new MCPGatewayServer(
      toolRegistry,
      clientManager,
      logger,
      resourceAggregation,
      promptAggregation,
    );
    return gatewayServer.getServer();
  });

  logger.info("MCP Lua Gateway running in stdio mode");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await handle.close();
    await clientManager.close();
    logger.info("Shutdown complete");
    process.exit(0);
  });
}

async function main() {
  const container = createContainer(config);

  // Route to appropriate mode based on transport config
  if (config.transport === "stdio") {
    await startStdioMode(container, config);
  } else {
    // Default to HTTP mode
    await startHttpMode(container, config);
  }
}

main().catch(console.error);
