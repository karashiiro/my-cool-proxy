import "reflect-metadata";
import type { TypedContainer } from "@inversifyjs/strongly-typed";
import { createContainer } from "./container/inversify.config.js";
import type { ContainerBindingMap } from "./container/binding-map.js";
import { TYPES } from "./types/index.js";
import type {
  ClientConnectionResult,
  ClientCapabilities,
  ICapabilityStore,
  ILogger,
  IMCPClientManager,
  ISamplingShim,
  IServerInfoPreloader,
  IShutdownHandler,
  ISkillDiscoveryService,
  ServerConfig,
} from "./types/interfaces.js";
import { serveHttp } from "@karashiiro/mcp/http";
import { serveStdio } from "@karashiiro/mcp/stdio";
import { loadConfig, mergeEnvConfig } from "./utils/config-loader.js";
import { MCPGatewayServer } from "./mcp/gateway-server.js";
import { registerProxyHandlers } from "./handlers/proxy-handlers.js";
import type { IToolRegistry } from "./tools/tool-registry.js";
import type {
  ResourceAggregationService,
  PromptAggregationService,
} from "@my-cool-proxy/mcp-aggregation";
import { parseArgs } from "./utils/cli-args.js";
import { getConfigPaths, getPlatformConfigDir } from "./utils/config-paths.js";
import { ensureServerLogDir, getServerLogPath } from "./utils/log-paths.js";
import { createSessionTempDir, cleanupSessionTempDir } from "./utils/index.js";

interface InitializationResult {
  successful: string[];
  failed: Array<{ name: string; error: string }>;
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
  clientCapabilities?: ClientCapabilities,
): Promise<InitializationResult> {
  // Ensure server log directory exists for stdio server stderr redirection
  ensureServerLogDir();

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
          clientConfig.dangerouslyEnableSampling,
        );
      } else if (clientConfig.type === "stdio") {
        // Generate log path for stdio server stderr
        const stderrLogPath = getServerLogPath(name, sessionId);
        return clientManager.addStdioClient(
          name,
          clientConfig.command,
          sessionId,
          clientConfig.args,
          clientConfig.env,
          clientConfig.allowedTools,
          clientCapabilities,
          stderrLogPath,
          clientConfig.dangerouslyEnableSampling,
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
  // This is the expensive part (creates temporary MCP connections), so we do it once
  logger.info("Preloading upstream server info...");
  const preloadedServers = await serverInfoPreloader.preloadServerInfo(config);
  const baseInstructions =
    serverInfoPreloader.buildAggregatedInstructions(preloadedServers);
  logger.info(
    `Preloaded info from ${preloadedServers.length} server(s) for gateway instructions`,
  );

  // If skills are enabled, ensure the directory exists at startup
  const skillsEnabled = config.skills?.enabled === true;
  if (skillsEnabled) {
    skillDiscoveryService.ensureSkillsDirectory();
  }

  // Start HTTP server with per-session factory
  const handle = await serveHttp(
    async (sessionId) => {
      logger.info(`Creating gateway server for session ${sessionId}`);

      // Discover skills fresh per session so runtime changes are reflected
      let sessionInstructions = baseInstructions;
      if (skillsEnabled) {
        const skills = await skillDiscoveryService.discoverSkills();
        if (skills.length > 0) {
          sessionInstructions +=
            serverInfoPreloader.buildSkillInstructions(skills);
        }
      }

      // Create gateway server FIRST (before upstream clients)
      // This allows us to capture downstream client capabilities during initialization
      // Pass preloaded instructions so downstream clients can see available servers
      const gatewayServer = new MCPGatewayServer(
        toolRegistry,
        clientManager,
        logger,
        resourceAggregation,
        promptAggregation,
        sessionInstructions,
      );

      // Resolve the sampling shim from the container if bound
      const samplingShim = container.isBound(TYPES.SamplingShim)
        ? container.get<ISamplingShim>(TYPES.SamplingShim)
        : undefined;

      // Set up callback to initialize upstream clients when downstream client connects
      // This ensures we forward the correct capabilities to upstream servers
      gatewayServer.setOnDownstreamInitialized(async (capabilities) => {
        logger.info(
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

        // Determine if we need the sampling shim:
        // Only when client lacks native sampling AND an ACP agent is configured
        let activeShim: ISamplingShim | undefined;
        let upstreamCapabilities = capabilities;

        if (!capabilities.sampling && samplingShim) {
          try {
            logger.info(
              `Session ${sessionId}: Client lacks sampling support, initializing ACP shim`,
            );
            await samplingShim.initialize(sessionId);
            activeShim = samplingShim;

            // Augment capabilities so upstream servers see sampling support.
            // This global augmentation is safe - buildClientCapabilities() filters
            // per-server based on dangerouslyEnableSampling, so only trusted servers
            // will see the sampling capability. Untrusted servers remain unaware.
            upstreamCapabilities = { ...capabilities, sampling: {} };
          } catch (error) {
            logger.error(
              "Failed to initialize sampling shim, continuing without sampling support",
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        }

        // Now initialize upstream MCP clients with the (possibly augmented) capabilities
        // This tells upstream servers what requests they can send through the proxy
        const initResult = await initializeClientsForSession(
          sessionId,
          config,
          clientManager,
          upstreamCapabilities,
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
        // Pass real capabilities (not augmented) so the native path doesn't activate
        // when only the shim is providing sampling
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
        // Clean up session-scoped state when sessions are closed
        onSessionClosed: async (sessionId) => {
          logger.debug(`Session ${sessionId} closed, cleaning up...`);
          try {
            await clientManager.closeSession(sessionId);

            // Clean up working directory if it's a tempdir
            const workingDir = capabilityStore.getWorkingDirectory(sessionId);
            if (workingDir && workingDir.includes("mcp-gateway-")) {
              // Only clean up if it's one of our tempdirs (contains our prefix)
              cleanupSessionTempDir(workingDir);
              logger.debug(
                `Cleaned up tempdir for session ${sessionId}: ${workingDir}`,
              );
            }

            capabilityStore.deleteCapabilities(sessionId);

            // Clean up sampling shim if active
            if (container.isBound(TYPES.SamplingShim)) {
              const shim = container.get<ISamplingShim>(TYPES.SamplingShim);
              await shim.close(sessionId);
            }
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

  // Discover skills at startup for instructions
  // Note: Unlike HTTP mode, stdio has a single session and a synchronous factory,
  // so skills are discovered once here rather than per-session.
  const skillsEnabled = config.skills?.enabled === true;
  if (skillsEnabled) {
    skillDiscoveryService.ensureSkillsDirectory();
    const skills = await skillDiscoveryService.discoverSkills();
    if (skills.length > 0) {
      const skillInstructions =
        serverInfoPreloader.buildSkillInstructions(skills);
      aggregatedInstructions += skillInstructions;
    }
  }

  // Resolve the sampling shim from the container if bound
  const samplingShim = container.isBound(TYPES.SamplingShim)
    ? container.get<ISamplingShim>(TYPES.SamplingShim)
    : undefined;

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

      // Create session-isolated tempdir for sampling shim
      // Note: roots/list is currently broken in the TS SDK, so we always use tempdir
      const workingDirectory = createSessionTempDir(SESSION_ID);
      logger.info(`Using tempdir as cwd: ${workingDirectory}`);

      // Store working directory BEFORE initializing shim
      capabilityStore.setWorkingDirectory(SESSION_ID, workingDirectory);

      // Determine if we need the sampling shim
      let activeShim: ISamplingShim | undefined;
      let upstreamCapabilities = capabilities;

      if (!capabilities.sampling && samplingShim) {
        try {
          logger.info(`Client lacks sampling support, initializing ACP shim`);
          await samplingShim.initialize(SESSION_ID);
          activeShim = samplingShim;

          // Augment capabilities so upstream servers see sampling support.
          // This global augmentation is safe - buildClientCapabilities() filters
          // per-server based on dangerouslyEnableSampling, so only trusted servers
          // will see the sampling capability. Untrusted servers remain unaware.
          upstreamCapabilities = { ...capabilities, sampling: {} };
        } catch (error) {
          logger.error(
            "Failed to initialize sampling shim, continuing without sampling support",
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }

      // Initialize upstream MCP clients with (possibly augmented) capabilities
      const initResult = await initializeClientsForSession(
        SESSION_ID,
        config,
        clientManager,
        upstreamCapabilities,
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
        activeShim,
      );
    });

    return gatewayServer.getServer();
  });

  logger.info("MCP Lua Gateway running in stdio mode");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await handle.close();
    await clientManager.close();

    // Clean up working directory if it's a tempdir
    const workingDir = capabilityStore.getWorkingDirectory(SESSION_ID);
    if (workingDir && workingDir.includes("mcp-gateway-")) {
      cleanupSessionTempDir(workingDir);
      logger.debug(`Cleaned up tempdir: ${workingDir}`);
    }

    // Clean up sampling shim if active
    if (samplingShim) {
      await samplingShim.closeAll();
    }

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
  console.log("See docs/configuration.md for full configuration reference.");
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
