import "reflect-metadata";
import type { TypedContainer } from "@inversifyjs/strongly-typed";
import { createContainer } from "./container/inversify.config.js";
import type { ContainerBindingMap } from "./container/binding-map.js";
import { TYPES } from "./types/index.js";
import type {
  ILogger,
  IShutdownHandler,
  IToolInspectionStore,
  ServerConfig,
} from "./types/interfaces.js";
import { serveHttp } from "@karashiiro/mcp/http";
import { serveStdio } from "@karashiiro/mcp/stdio";
import { loadConfig, mergeEnvConfig } from "./utils/config-loader.js";
import { MCPGatewayServer } from "./mcp/gateway-server.js";
import type { IResourceRoutingService } from "@my-cool-proxy/mcp-aggregation";
import { parseArgs } from "./utils/cli-args.js";
import { getConfigPaths, getPlatformConfigDir } from "./utils/config-paths.js";
import { cleanupSessionTempDir } from "./utils/index.js";
import { SQLiteEventStore } from "./stores/sqlite-event-store.js";
import {
  initializeSqlite,
  resolveCommonServices,
  preloadInstructions,
  handleDownstreamInitialized,
} from "./startup.js";

/**
 * Session inactivity timeout in milliseconds.
 * Sessions expire after this duration of inactivity.
 */
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function startHttpMode(
  container: TypedContainer<ContainerBindingMap>,
  config: ServerConfig,
) {
  const logger = container.get<ILogger>(TYPES.Logger);

  // Ensure port and host are defined (validation should guarantee this)
  if (config.port === undefined || config.host === undefined) {
    throw new Error("Port and host are required for HTTP mode");
  }

  // Initialize SQLite persistence with capability store rebinding for HTTP mode
  const { sqliteDb } = initializeSqlite(container, config, logger, {
    rebindCapabilityStore: true,
  });

  // Resolve shared services (after SQLite rebindings so we get the SQLite-backed stores)
  const services = resolveCommonServices(container);

  // HTTP-specific services
  const shutdownHandler = container.get<IShutdownHandler>(
    TYPES.ShutdownHandler,
  );
  const routingService = container.get<IResourceRoutingService>(
    TYPES.ResourceRoutingService,
  );
  const toolInspectionStore = container.get<IToolInspectionStore>(
    TYPES.ToolInspectionStore,
  );

  // Preload upstream server info (skills discovered per-session in HTTP mode)
  const baseInstructions = await preloadInstructions(
    config,
    services.serverInfoPreloader,
    services.skillDiscoveryService,
    logger,
  );
  const skillsEnabled = config.skills?.enabled === true;

  // Track session initialization for restoration support
  // Each session has a promise that resolves when upstream servers are connected
  const sessionInitPromises = new Map<
    string,
    { promise: Promise<void>; resolve: () => void }
  >();

  // Helper to get or create init promise for a session
  const getSessionInitPromise = (sessionId: string) => {
    let entry = sessionInitPromises.get(sessionId);
    if (!entry) {
      let resolve: () => void = () => {};
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      entry = { promise, resolve };
      sessionInitPromises.set(sessionId, entry);
    }
    return entry;
  };

  // Start HTTP server with per-session factory
  const handle = await serveHttp(
    async (sessionId) => {
      logger.info(`Creating gateway server for session ${sessionId}`);

      // Discover skills fresh per session so runtime changes are reflected
      let sessionInstructions = baseInstructions;
      if (skillsEnabled) {
        const skills = await services.skillDiscoveryService.discoverSkills();
        if (skills.length > 0) {
          sessionInstructions +=
            services.serverInfoPreloader.buildSkillInstructions(skills);
        }
      }

      // Create gateway server FIRST (before upstream clients)
      // This allows us to capture downstream client capabilities during initialization
      const gatewayServer = new MCPGatewayServer(
        services.toolRegistry,
        services.clientManager,
        logger,
        services.resourceAggregation,
        services.promptAggregation,
        services.completionAggregation,
        sessionInstructions,
      );

      // Set up callback to initialize upstream clients when downstream client connects
      gatewayServer.setOnDownstreamInitialized(async (capabilities) => {
        await handleDownstreamInitialized(
          sessionId,
          capabilities,
          config,
          services,
          gatewayServer,
        );

        // Signal that this session is fully initialized (upstream servers connected)
        // This allows restored sessions to wait for completion before accepting requests
        getSessionInitPromise(sessionId).resolve();
      });

      return gatewayServer.getServer();
    },
    {
      port: config.port,
      host: config.host,
      sessions: {
        // Session expires after 5 minutes of inactivity (default is 30 minutes)
        sessionTtlMs: SESSION_TTL_MS,
        // SQLite-backed event store for SSE resumability across restarts
        eventStoreFactory: (sessionId) =>
          new SQLiteEventStore(sqliteDb, sessionId),
        // Clean up session-scoped state when sessions are closed
        onSessionClosed: async (sessionId) => {
          logger.info(`Session ${sessionId} closed, cleaning up...`);
          try {
            await services.clientManager.closeSession(sessionId);

            // Clean up working directory if it's a tempdir
            const workingDir =
              services.capabilityStore.getWorkingDirectory(sessionId);
            if (workingDir && workingDir.includes("mcp-gateway-")) {
              // Only clean up if it's one of our tempdirs (contains our prefix)
              cleanupSessionTempDir(workingDir);
              logger.info(
                `Cleaned up tempdir for session ${sessionId}: ${workingDir}`,
              );
            }

            services.capabilityStore.deleteCapabilities(sessionId);

            // Clean up resource routing data
            routingService.deleteSession(sessionId);

            // Clean up tool inspection tracking
            toolInspectionStore.deleteSession(sessionId);

            // Clean up sampling shim if active
            if (services.samplingShim) {
              await services.samplingShim.close(sessionId);
            }

            // Clean up init promise tracking
            sessionInitPromises.delete(sessionId);
          } catch (error) {
            // Log but don't re-throw - ensure callback doesn't fail the cleanup
            logger.error(
              `Failed to close session ${sessionId}`,
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        },
        // Wait for session to be fully initialized after restoration
        // This ensures upstream servers are connected before accepting requests
        onSessionRestored: async (sessionId) => {
          logger.info(
            `Session ${sessionId} restored, waiting for upstream servers...`,
          );
          const entry = getSessionInitPromise(sessionId);
          await entry.promise;
          logger.info(
            `Session ${sessionId} restoration complete, upstream servers ready`,
          );
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
    sqliteDb.close();
    logger.info("SQLite database closed");
  });
}

async function startStdioMode(
  container: TypedContainer<ContainerBindingMap>,
  config: ServerConfig,
) {
  const logger = container.get<ILogger>(TYPES.Logger);

  // Initialize SQLite for execution logging (no capability store rebind for stdio)
  const { sqliteDb } = initializeSqlite(container, config, logger);

  // Resolve shared services (after SQLite rebindings)
  const services = resolveCommonServices(container);

  // Fixed session ID for stdio (single session mode)
  const SESSION_ID = "default";

  // Preload upstream server info and discover skills eagerly (single session)
  const aggregatedInstructions = await preloadInstructions(
    config,
    services.serverInfoPreloader,
    services.skillDiscoveryService,
    logger,
    { discoverSkillsNow: true },
  );

  // Start stdio server - upstream clients are initialized when downstream connects
  const handle = await serveStdio(() => {
    // Create gateway server FIRST
    const gatewayServer = new MCPGatewayServer(
      services.toolRegistry,
      services.clientManager,
      logger,
      services.resourceAggregation,
      services.promptAggregation,
      services.completionAggregation,
      aggregatedInstructions,
    );

    // Set up callback to initialize upstream clients when downstream client connects
    gatewayServer.setOnDownstreamInitialized(async (capabilities) => {
      await handleDownstreamInitialized(
        SESSION_ID,
        capabilities,
        config,
        services,
        gatewayServer,
      );
    });

    return gatewayServer.getServer();
  });

  logger.info("MCP Lua Gateway running in stdio mode");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await handle.close();
    await services.clientManager.close();

    // Clean up working directory if it's a tempdir
    const workingDir = services.capabilityStore.getWorkingDirectory(SESSION_ID);
    if (workingDir && workingDir.includes("mcp-gateway-")) {
      cleanupSessionTempDir(workingDir);
      logger.debug(`Cleaned up tempdir: ${workingDir}`);
    }

    // Clean up sampling shim if active
    if (services.samplingShim) {
      await services.samplingShim.closeAll();
    }

    sqliteDb.close();
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
