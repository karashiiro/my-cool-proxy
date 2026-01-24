import "reflect-metadata";
import type { TypedContainer } from "@inversifyjs/strongly-typed";
import { createContainer } from "./container/inversify.config.js";
import type { ContainerBindingMap } from "./container/binding-map.js";
import { TYPES } from "./types/index.js";
import type {
  ClientConnectionResult,
  DownstreamCapabilities,
  ICapabilityStore,
  ILogger,
  IMCPClientManager,
  IServerInfoPreloader,
  IShutdownHandler,
  ISkillDiscoveryService,
  ServerConfig,
} from "./types/interfaces.js";
import { serveHttp } from "@karashiiro/mcp/http";
import { serveStdio } from "@karashiiro/mcp/stdio";
import { loadConfig, mergeEnvConfig } from "./utils/config-loader.js";
import { MCPGatewayServer } from "./mcp/gateway-server.js";
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { IToolRegistry } from "./tools/tool-registry.js";
import type {
  ResourceAggregationService,
  PromptAggregationService,
} from "@my-cool-proxy/mcp-aggregation";
import { parseArgs } from "./utils/cli-args.js";
import { getConfigPaths, getPlatformConfigDir } from "./utils/config-paths.js";

interface InitializationResult {
  successful: string[];
  failed: Array<{ name: string; error: string }>;
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
 * Uses Promise.allSettled to connect to all servers in parallel and continue
 * even if some fail.
 *
 * @param sessionId - The session ID to initialize clients for
 * @param config - Server configuration with MCP client definitions
 * @param clientManager - The client manager to create clients with
 * @param clientCapabilities - Optional downstream client capabilities to forward to upstream servers
 */
async function initializeClientsForSession(
  sessionId: string,
  config: ServerConfig,
  clientManager: IMCPClientManager,
  clientCapabilities?: DownstreamCapabilities,
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
          clientCapabilities,
        );
      } else if (clientConfig.type === "stdio") {
        return clientManager.addStdioClient(
          name,
          clientConfig.command,
          sessionId,
          clientConfig.args,
          clientConfig.env,
          clientConfig.allowedTools,
          clientCapabilities,
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
  const capabilityStore = container.get<ICapabilityStore>(
    TYPES.CapabilityStore,
  );
  const serverInfoPreloader = container.get<IServerInfoPreloader>(
    TYPES.ServerInfoPreloader,
  );
  const skillDiscoveryService = container.get<ISkillDiscoveryService>(
    TYPES.SkillDiscoveryService,
  );

  // Preload upstream server info at startup to populate gateway instructions
  logger.info("Preloading upstream server info...");
  const preloadedServers = await serverInfoPreloader.preloadServerInfo(config);
  let aggregatedInstructions =
    serverInfoPreloader.buildAggregatedInstructions(preloadedServers);
  logger.info(
    `Preloaded info from ${preloadedServers.length} server(s) for gateway instructions`,
  );

  // Ensure default skills exist, then discover and append skill instructions
  await skillDiscoveryService.ensureDefaultSkills();
  const skills = await skillDiscoveryService.discoverSkills();
  if (skills.length > 0) {
    const skillInstructions =
      serverInfoPreloader.buildSkillInstructions(skills);
    aggregatedInstructions += skillInstructions;
  }

  // Start HTTP server with per-session factory
  const handle = await serveHttp(
    async (sessionId) => {
      logger.info(`Creating gateway server for session ${sessionId}`);

      // Create gateway server FIRST (before upstream clients)
      // This allows us to capture downstream client capabilities during initialization
      // Pass preloaded instructions so downstream clients can see available servers
      const gatewayServer = new MCPGatewayServer(
        toolRegistry,
        clientManager,
        logger,
        resourceAggregation,
        promptAggregation,
        aggregatedInstructions,
      );

      // Set up callback to initialize upstream clients when downstream client connects
      // This ensures we forward the correct capabilities to upstream servers
      gatewayServer.setOnDownstreamInitialized(async (capabilities) => {
        logger.info(
          `Session ${sessionId}: Downstream client initialized with capabilities: ` +
            `sampling=${!!capabilities.sampling}, elicitation=${!!capabilities.elicitation}`,
        );

        // Store capabilities for this session
        capabilityStore.setCapabilities(sessionId, capabilities);

        // Now initialize upstream MCP clients with the downstream capabilities
        // This tells upstream servers what requests they can send through the proxy
        const initResult = await initializeClientsForSession(
          sessionId,
          config,
          clientManager,
          capabilities,
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
            `Session ${sessionId}: All configured servers failed to connect.`,
          );
        }

        logger.info(
          `Session ${sessionId}: ${initResult.successful.length} server(s) connected successfully`,
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
        // Clean up session-scoped state when sessions are closed
        onSessionClosed: async (sessionId) => {
          logger.debug(`Session ${sessionId} closed, cleaning up...`);
          try {
            await clientManager.closeSession(sessionId);
            capabilityStore.deleteCapabilities(sessionId);
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
  const capabilityStore = container.get<ICapabilityStore>(
    TYPES.CapabilityStore,
  );
  const serverInfoPreloader = container.get<IServerInfoPreloader>(
    TYPES.ServerInfoPreloader,
  );
  const skillDiscoveryService = container.get<ISkillDiscoveryService>(
    TYPES.SkillDiscoveryService,
  );

  // Fixed session ID for stdio (single session mode)
  const SESSION_ID = "default";

  // Preload upstream server info at startup to populate gateway instructions
  logger.info("Preloading upstream server info...");
  const preloadedServers = await serverInfoPreloader.preloadServerInfo(config);
  let aggregatedInstructions =
    serverInfoPreloader.buildAggregatedInstructions(preloadedServers);
  logger.info(
    `Preloaded info from ${preloadedServers.length} server(s) for gateway instructions`,
  );

  // Ensure default skills exist, then discover and append skill instructions
  await skillDiscoveryService.ensureDefaultSkills();
  const skills = await skillDiscoveryService.discoverSkills();
  if (skills.length > 0) {
    const skillInstructions =
      serverInfoPreloader.buildSkillInstructions(skills);
    aggregatedInstructions += skillInstructions;
  }

  // Start stdio server - upstream clients are initialized when downstream connects
  const handle = await serveStdio(() => {
    // Create gateway server FIRST
    // Pass preloaded instructions so downstream clients can see available servers
    const gatewayServer = new MCPGatewayServer(
      toolRegistry,
      clientManager,
      logger,
      resourceAggregation,
      promptAggregation,
      aggregatedInstructions,
    );

    // Set up callback to initialize upstream clients when downstream client connects
    gatewayServer.setOnDownstreamInitialized(async (capabilities) => {
      logger.info(
        `Downstream client initialized with capabilities: ` +
          `sampling=${!!capabilities.sampling}, elicitation=${!!capabilities.elicitation}`,
      );

      // Store capabilities
      capabilityStore.setCapabilities(SESSION_ID, capabilities);

      // Initialize upstream MCP clients with downstream capabilities
      const initResult = await initializeClientsForSession(
        SESSION_ID,
        config,
        clientManager,
        capabilities,
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
          `All configured servers failed to connect. Gateway running but no servers available.`,
        );
      }

      logger.info(
        `${initResult.successful.length} server(s) connected successfully`,
      );

      // Register proxy handlers for sampling/elicitation forwarding
      registerProxyHandlers(
        SESSION_ID,
        clientManager,
        gatewayServer,
        logger,
        capabilities,
      );
    });

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

/**
 * Print help information and exit.
 *
 * Note: We use console.log here instead of the injected logger because
 * these CLI utilities run before the DI container is created (which requires
 * loading config first). This is intentional - we want to show help/config
 * info even when config is missing or invalid.
 */
function printHelp(): void {
  console.log(
    "MCP Lua Gateway - Proxy for multiple MCP servers with Lua scripting\n",
  );
  console.log("Usage: my-cool-proxy [options]\n");
  console.log("Options:");
  console.log("  -c, --config-path    Show config file search paths and exit");
  console.log("  -h, --help           Show this help message and exit\n");
  console.log("Environment variables:");
  console.log("  CONFIG_PATH          Override config file location");
  console.log("  PORT                 Override server port (HTTP mode)");
  console.log("  HOST                 Override server host (HTTP mode)\n");
  console.log("See CONFIG.md for full configuration reference.");
}

/**
 * Print config path information and exit.
 *
 * Note: We use console.log here instead of the injected logger because
 * these CLI utilities run before the DI container is created.
 */
function printConfigPaths(): void {
  console.log("Config file search order:\n");
  const paths = getConfigPaths();
  for (const p of paths) {
    const status = p.exists ? "[EXISTS]" : "[NOT FOUND]";
    const label = p.source === "env" ? "ENV: CONFIG_PATH" : "Platform config";
    console.log(`  ${status} ${label}`);
    console.log(`          ${p.path}\n`);
  }
  console.log(`Platform config directory: ${getPlatformConfigDir()}`);
}

async function main() {
  // Handle CLI arguments before loading config
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.showConfigPath) {
    printConfigPaths();
    process.exit(0);
  }

  // Load configuration from file and merge with environment variables
  const config = mergeEnvConfig(loadConfig());
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
