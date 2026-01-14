import "reflect-metadata";
import type { TypedContainer } from "@inversifyjs/strongly-typed";
import { createContainer } from "./container/inversify.config.js";
import type { ContainerBindingMap } from "./container/binding-map.js";
import { TYPES } from "./types/index.js";
import type {
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

/**
 * Initialize MCP clients for a given session.
 */
async function initializeClientsForSession(
  sessionId: string,
  config: ServerConfig,
  clientManager: IMCPClientManager,
): Promise<void> {
  for (const [name, clientConfig] of Object.entries(config.mcpClients)) {
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

      // Initialize MCP clients for this session
      await initializeClientsForSession(sessionId, config, clientManager);

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
      sessions: {},
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

  // Initialize all configured MCP clients upfront
  await initializeClientsForSession(SESSION_ID, config, clientManager);

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
