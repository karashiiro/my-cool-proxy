import "reflect-metadata";
import fs from "node:fs";
import path from "node:path";
import type { TypedContainer } from "@inversifyjs/strongly-typed";
import { createContainer } from "./container/inversify.config.js";
import type { ContainerBindingMap } from "./container/binding-map.js";
import { TYPES } from "./types/index.js";
import type {
  ICapabilityStore,
  IExecutionLog,
  ILogger,
  IMCPClientManager,
  IShutdownHandler,
  ServerConfig,
} from "./types/interfaces.js";
import { serveHttp } from "@karashiiro/mcp/http";
import { serveStdio } from "@karashiiro/mcp/stdio";
import { loadConfig, mergeEnvConfig } from "./utils/config-loader.js";
import { MCPGatewayServer } from "./mcp/gateway-server.js";
import type { IResourceRoutingService } from "@my-cool-proxy/mcp-aggregation";
import { parseArgs } from "./utils/cli-args.js";
import { getConfigPaths, getPlatformConfigDir } from "./utils/config-paths.js";
import { appPaths } from "./utils/app-paths.js";
import { cleanupSessionTempDir } from "./utils/index.js";
import { SQLiteEventStore } from "./stores/sqlite-event-store.js";
import {
  initializeSqlite,
  resolveCommonServices,
  preloadInstructions,
  handleDownstreamInitialized,
} from "./startup.js";
import { startDashboardServer } from "./dashboard/dashboard-server.js";
import { NotifyingExecutionLog } from "./dashboard/notifying-execution-log.js";
import type { DashboardHandle, DashboardEvent } from "./dashboard/types.js";
import type { SQLiteDatabase } from "./stores/sqlite-database.js";
import { resolvePackageRoot } from "./utils/package-root.js";

/**
 * Session inactivity timeout in milliseconds.
 * Sessions expire after this duration of inactivity.
 */
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Resolve the dashboard static files directory.
 *
 * In production (built with tsup), the bundle is at dist/index.js so the
 * package root resolves to the gateway package directory, and dashboard files
 * are co-located at dist/dashboard/. In dev mode (tsx), we fall back to the
 * dashboard-ui package build output.
 */
const PACKAGE_ROOT = resolvePackageRoot(import.meta.url);
const DASHBOARD_STATIC_DIR = (() => {
  // Production / after build: co-located in dist/dashboard/
  const distPath = path.join(PACKAGE_ROOT, "dist", "dashboard");
  if (fs.existsSync(path.join(distPath, "index.html"))) {
    return distPath;
  }
  // Dev mode fallback: try the dashboard-ui build output directly
  const directPath = path.resolve(
    PACKAGE_ROOT,
    "..",
    "..",
    "packages",
    "dashboard-ui",
    "build",
  );
  if (!fs.existsSync(path.join(directPath, "index.html"))) {
    // Log to stderr since logger isn't available yet at module scope
    console.error(
      "Warning: Dashboard UI static files not found in any expected location. " +
        "Run 'pnpm build' to build the dashboard UI.",
    );
  }
  return directPath;
})();

/**
 * Start the dashboard server if configured.
 * Returns a handle for graceful shutdown, or undefined if dashboard is not configured.
 */
async function maybeStartDashboard(
  container: TypedContainer<ContainerBindingMap>,
  config: ServerConfig,
  sqliteDb: SQLiteDatabase,
  logger: ILogger,
): Promise<DashboardHandle | undefined> {
  if (!config.dashboard) return undefined;

  const executionLog = container.get<IExecutionLog>(TYPES.ExecutionLog);
  const clientManager = container.get<IMCPClientManager>(
    TYPES.MCPClientManager,
  );
  const capabilityStore = container.get<ICapabilityStore>(
    TYPES.CapabilityStore,
  );
  return startDashboardServer(
    executionLog,
    clientManager,
    capabilityStore,
    sqliteDb,
    config.dashboard,
    DASHBOARD_STATIC_DIR,
    logger,
  );
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

  // Initialize SQLite persistence with capability store rebinding for HTTP mode
  const { sqliteDb } = initializeSqlite(container, config, logger, {
    rebindCapabilityStore: true,
  });

  // Install NotifyingExecutionLog for dashboard WebSocket broadcasts
  let broadcastFn: ((event: DashboardEvent) => void) | undefined;
  let pendingEvents: DashboardEvent[] = [];
  if (config.dashboard) {
    const innerLog = container.get<IExecutionLog>(TYPES.ExecutionLog);
    const notifyingLog = new NotifyingExecutionLog(innerLog, (event) => {
      if (broadcastFn) broadcastFn(event);
      else pendingEvents.push(event);
    });
    container.unbind(TYPES.ExecutionLog);
    container
      .bind<IExecutionLog>(TYPES.ExecutionLog)
      .toConstantValue(notifyingLog);
  }

  // Resolve shared services (after SQLite rebindings so we get the SQLite-backed stores)
  const services = resolveCommonServices(container);

  // HTTP-specific services
  const shutdownHandler = container.get<IShutdownHandler>(
    TYPES.ShutdownHandler,
  );
  const routingService = container.get<IResourceRoutingService>(
    TYPES.ResourceRoutingService,
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

  // Graceful shutdown: reject new sessions once shutdown begins
  let shuttingDown = false;

  // Start HTTP server with per-session factory
  const handle = await serveHttp(
    async (sessionId) => {
      if (shuttingDown) {
        throw new Error("Server is shutting down, rejecting new session");
      }

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
        broadcastFn?.({ type: "session:changed" });
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
        eventStoreFactory: (sessionId) => {
          // Insert a placeholder sessions row eagerly so that child tables
          // (mcp_events, session_init_requests) can write their FK-constrained
          // rows before setCapabilities() is called by onSessionInitialized.
          // setCapabilities() uses INSERT OR ... DO UPDATE, so it will simply
          // update this placeholder when the real capabilities arrive.
          sqliteDb
            .getDatabase()
            .prepare(
              `INSERT OR IGNORE INTO sessions (session_id, created_at, last_activity)
               VALUES (?, ?, ?)`,
            )
            .run(sessionId, Date.now(), Date.now());
          return new SQLiteEventStore(sqliteDb, sessionId);
        },
        // Clean up session-scoped state when sessions are closed
        onSessionClosed: async (sessionId) => {
          logger.info(`Session ${sessionId} closed, cleaning up...`);
          broadcastFn?.({ type: "session:changed" });
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

            // NOTE: Session data (capabilities, init requests, events) is intentionally
            // NOT deleted from SQLite here. The SDK preserves event stores across transport
            // close and shutdown to enable session restoration after restart. Deleting the
            // sessions row would cascade-delete session_init_requests and mcp_events,
            // breaking restoration. Stale sessions are cleaned by purgeOldData (retention
            // policy). Explicit DELETE requests are handled by the SDK via eventStore.clear().

            // Clean up resource routing data
            routingService.deleteSession(sessionId);

            // NOTE: Tool inspection state is intentionally NOT cleaned up here.
            // It is persisted in SQLite so that agents don't need to re-call
            // tool-details after a gateway restart (issue #79). Stale records
            // are cleaned up by purgeOldData based on retention policy.

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

  // Start dashboard server if configured
  const dashboardHandle = await maybeStartDashboard(
    container,
    config,
    sqliteDb,
    logger,
  );
  if (dashboardHandle) {
    broadcastFn = dashboardHandle.broadcast;
    for (const event of pendingEvents) broadcastFn(event);
    pendingEvents = [];
  }

  // Graceful shutdown with double-shutdown guard
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down HTTP mode...");

    try {
      if (dashboardHandle) {
        await dashboardHandle.close();
        logger.info("Dashboard server closed");
      }
    } catch (err) {
      logger.error(
        "Error closing dashboard server",
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    try {
      const SHUTDOWN_TIMEOUT_MS = 5_000;
      await Promise.race([
        handle.close(),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            logger.warn("HTTP server shutdown timed out, forcing close");
            resolve();
          }, SHUTDOWN_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      logger.error(
        "Error closing HTTP server",
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    try {
      await shutdownHandler.shutdown();
    } catch (err) {
      logger.error(
        "Error in shutdown handler",
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    try {
      sqliteDb.close();
      logger.info("SQLite database closed");
    } catch (err) {
      logger.error(
        "Error closing SQLite",
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function startStdioMode(
  container: TypedContainer<ContainerBindingMap>,
  config: ServerConfig,
) {
  const logger = container.get<ILogger>(TYPES.Logger);

  // Initialize SQLite for execution logging (no capability store rebind for stdio)
  const { sqliteDb } = initializeSqlite(container, config, logger);

  // Fixed session ID for stdio (single session mode)
  const STDIO_SESSION_ID = "default";

  // Insert a placeholder sessions row so that lua_executions and tool_inspections
  // (which have FK constraints on sessions.session_id) can write rows even though
  // the in-memory capability store never inserts into the sessions table.
  sqliteDb
    .getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO sessions (session_id, created_at, last_activity)
       VALUES (?, ?, ?)`,
    )
    .run(STDIO_SESSION_ID, Date.now(), Date.now());

  // Install NotifyingExecutionLog for dashboard WebSocket broadcasts
  let broadcastFn: ((event: DashboardEvent) => void) | undefined;
  let pendingEvents: DashboardEvent[] = [];
  if (config.dashboard) {
    const innerLog = container.get<IExecutionLog>(TYPES.ExecutionLog);
    const notifyingLog = new NotifyingExecutionLog(innerLog, (event) => {
      if (broadcastFn) broadcastFn(event);
      else pendingEvents.push(event);
    });
    container.unbind(TYPES.ExecutionLog);
    container
      .bind<IExecutionLog>(TYPES.ExecutionLog)
      .toConstantValue(notifyingLog);
  }

  // Resolve shared services (after SQLite rebindings)
  const services = resolveCommonServices(container);

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
        STDIO_SESSION_ID,
        capabilities,
        config,
        services,
        gatewayServer,
      );
    });

    return gatewayServer.getServer();
  });

  logger.info("MCP Lua Gateway running in stdio mode");

  // Start dashboard server if configured
  const dashboardHandle = await maybeStartDashboard(
    container,
    config,
    sqliteDb,
    logger,
  );
  if (dashboardHandle) {
    broadcastFn = dashboardHandle.broadcast;
    for (const event of pendingEvents) broadcastFn(event);
    pendingEvents = [];
  }

  // Graceful shutdown with double-shutdown guard
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down stdio mode...");

    try {
      if (dashboardHandle) {
        await dashboardHandle.close();
        logger.info("Dashboard server closed");
      }
    } catch (err) {
      logger.error(
        "Error closing dashboard server",
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    try {
      await handle.close();
    } catch (err) {
      logger.error(
        "Error closing stdio server",
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    try {
      await services.clientManager.close();
    } catch (err) {
      logger.error(
        "Error closing client manager",
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    // Clean up working directory if it's a tempdir
    try {
      const workingDir =
        services.capabilityStore.getWorkingDirectory(STDIO_SESSION_ID);
      if (workingDir && workingDir.includes("mcp-gateway-")) {
        cleanupSessionTempDir(workingDir);
        logger.debug(`Cleaned up tempdir: ${workingDir}`);
      }
    } catch (err) {
      logger.error(
        "Error cleaning up tempdir",
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    // Clean up sampling shim if active
    try {
      if (services.samplingShim) {
        await services.samplingShim.closeAll();
      }
    } catch (err) {
      logger.error(
        "Error closing sampling shim",
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    try {
      sqliteDb.close();
    } catch (err) {
      logger.error(
        "Error closing SQLite",
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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
  console.log("      --paths          Show all platform directories and exit");
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

/**
 * Print all platform-specific directory paths and exit.
 *
 * Note: We use console.log here instead of the injected logger because
 * these CLI utilities run before the DI container is created.
 */
function printPaths(): void {
  console.log("Platform directories:\n");
  console.log(`  Config:  ${appPaths.config}`);
  console.log(`  Data:    ${appPaths.data}`);
  console.log(`  Log:     ${appPaths.log}`);
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

  if (args.showPaths) {
    printPaths();
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
