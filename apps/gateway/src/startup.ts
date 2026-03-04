import type { TypedContainer } from "@inversifyjs/strongly-typed";
import type { ContainerBindingMap } from "./container/binding-map.js";
import { TYPES } from "./types/index.js";
import type {
  ClientCapabilities,
  ClientConnectionResult,
  ICapabilityStore,
  IExecutionLog,
  ILogger,
  IMCPClientManager,
  ISamplingShim,
  IServerInfoPreloader,
  ISkillDiscoveryService,
  IToolInspectionStore,
  ServerConfig,
} from "./types/interfaces.js";
import type { IToolRegistry } from "./tools/tool-registry.js";
import type {
  ResourceAggregationService,
  PromptAggregationService,
  CompletionAggregationService,
} from "@my-cool-proxy/mcp-aggregation";
import { MCPGatewayServer } from "./mcp/gateway-server.js";
import { registerProxyHandlers } from "./handlers/proxy-handlers.js";
import {
  createSessionTempDir,
  initializeSamplingShim,
  withTimeout,
} from "./utils/index.js";
import { findValidLocalRoot } from "./utils/root-utils.js";
import { ensureServerLogDir, getServerLogPath } from "./utils/log-paths.js";
import { getDbPath, ensureDbDirectory } from "./utils/db-paths.js";
import { SQLiteDatabase } from "./stores/sqlite-database.js";
import { SQLiteCapabilityStore } from "./stores/sqlite-capability-store.js";
import { SQLiteExecutionLog } from "./stores/sqlite-execution-log.js";
import { SQLiteToolInspectionStore } from "./stores/sqlite-tool-inspection-store.js";

/**
 * Common services resolved from the DI container.
 * Must be resolved AFTER any container rebindings (e.g., SQLite stores).
 */
export interface CommonServices {
  logger: ILogger;
  clientManager: IMCPClientManager;
  toolRegistry: IToolRegistry;
  resourceAggregation: ResourceAggregationService;
  promptAggregation: PromptAggregationService;
  completionAggregation: CompletionAggregationService;
  capabilityStore: ICapabilityStore;
  serverInfoPreloader: IServerInfoPreloader;
  skillDiscoveryService: ISkillDiscoveryService;
  samplingShim: ISamplingShim | undefined;
}

export interface SqliteInitResult {
  sqliteDb: SQLiteDatabase;
}

interface InitializationResult {
  successful: string[];
  failed: Array<{ name: string; error: string }>;
}

/**
 * Initialize SQLite database, purge old data, and rebind DI container stores.
 *
 * @param options.rebindCapabilityStore - If true, creates a SQLiteCapabilityStore
 *   and rebinds TYPES.CapabilityStore in the container (used by HTTP mode for
 *   session persistence across restarts).
 */
export function initializeSqlite(
  container: TypedContainer<ContainerBindingMap>,
  config: ServerConfig,
  logger: ILogger,
  options?: { rebindCapabilityStore?: boolean },
): SqliteInitResult {
  ensureDbDirectory();
  const dbPath = getDbPath();
  const sqliteDb = new SQLiteDatabase(dbPath);
  logger.info(`SQLite database enabled: ${dbPath}`);

  // Purge old data based on retention policy
  const retentionDays = config.database?.retentionDays ?? 7;
  const purged = sqliteDb.purgeOldData(retentionDays);
  const totalPurged =
    purged.luaToolCalls +
    purged.luaExecutions +
    purged.mcpEvents +
    purged.toolInspections +
    purged.sessionInitRequests +
    purged.sessions;
  if (totalPurged > 0) {
    logger.info(
      { retentionDays, ...purged },
      `Purged ${totalPurged} expired rows (retention: ${retentionDays} days)`,
    );
  }

  // Rebind execution log to SQLite-backed implementation
  container.unbind(TYPES.ExecutionLog);
  container
    .bind<IExecutionLog>(TYPES.ExecutionLog)
    .toConstantValue(new SQLiteExecutionLog(sqliteDb));

  // Optionally rebind capability store to SQLite-backed implementation
  if (options?.rebindCapabilityStore) {
    const capabilityStore = new SQLiteCapabilityStore(sqliteDb, logger);
    container.unbind(TYPES.CapabilityStore);
    container
      .bind<ICapabilityStore>(TYPES.CapabilityStore)
      .toConstantValue(capabilityStore);
  }

  // Rebind tool inspection store to SQLite-backed implementation
  // so tool-details state survives restarts (both HTTP and stdio modes)
  container.unbind(TYPES.ToolInspectionStore);
  container
    .bind<IToolInspectionStore>(TYPES.ToolInspectionStore)
    .toConstantValue(new SQLiteToolInspectionStore(sqliteDb));

  return { sqliteDb };
}

/**
 * Resolve common services from the DI container.
 * Call this AFTER initializeSqlite so any container rebindings are picked up.
 */
export function resolveCommonServices(
  container: TypedContainer<ContainerBindingMap>,
): CommonServices {
  return {
    logger: container.get<ILogger>(TYPES.Logger),
    clientManager: container.get<IMCPClientManager>(TYPES.MCPClientManager),
    toolRegistry: container.get<IToolRegistry>(TYPES.ToolRegistry),
    resourceAggregation: container.get<ResourceAggregationService>(
      TYPES.ResourceAggregationService,
    ),
    promptAggregation: container.get<PromptAggregationService>(
      TYPES.PromptAggregationService,
    ),
    completionAggregation: container.get<CompletionAggregationService>(
      TYPES.CompletionAggregationService,
    ),
    capabilityStore: container.get<ICapabilityStore>(TYPES.CapabilityStore),
    serverInfoPreloader: container.get<IServerInfoPreloader>(
      TYPES.ServerInfoPreloader,
    ),
    skillDiscoveryService: container.get<ISkillDiscoveryService>(
      TYPES.SkillDiscoveryService,
    ),
    samplingShim: container.isBound(TYPES.SamplingShim)
      ? container.get<ISamplingShim>(TYPES.SamplingShim)
      : undefined,
  };
}

/**
 * Preload upstream server info and optionally discover skills.
 *
 * @param options.discoverSkillsNow - If true, discovers skills immediately and
 *   appends their instructions. Stdio mode uses this (single session, discovered once).
 *   HTTP mode skips this and discovers skills per-session in the factory.
 * @returns The aggregated instructions string for the gateway server.
 */
export async function preloadInstructions(
  config: ServerConfig,
  serverInfoPreloader: IServerInfoPreloader,
  skillDiscoveryService: ISkillDiscoveryService,
  logger: ILogger,
  options?: { discoverSkillsNow?: boolean },
): Promise<string> {
  logger.info("Preloading upstream server info...");
  const preloadedServers = await serverInfoPreloader.preloadServerInfo(config);
  let instructions =
    serverInfoPreloader.buildAggregatedInstructions(preloadedServers);
  logger.info(
    `Preloaded info from ${preloadedServers.length} server(s) for gateway instructions`,
  );

  const skillsEnabled = config.skills?.enabled === true;
  if (skillsEnabled) {
    skillDiscoveryService.ensureSkillsDirectory();

    if (options?.discoverSkillsNow) {
      const skills = await skillDiscoveryService.discoverSkills();
      if (skills.length > 0) {
        instructions += serverInfoPreloader.buildSkillInstructions(skills);
      }
    }
  }

  return instructions;
}

/**
 * Initialize MCP clients for a given session.
 * Uses Promise.allSettled to connect to all servers in parallel and continue
 * even if some fail.
 */
export async function initializeClientsForSession(
  sessionId: string,
  config: ServerConfig,
  clientManager: IMCPClientManager,
  clientCapabilities?: ClientCapabilities,
  cwd?: string,
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
          cwd,
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

/**
 * Shared handler for when a downstream client completes MCP initialization.
 * Both HTTP and stdio modes perform the same sequence: store capabilities,
 * create a working directory, initialize the sampling shim, connect to
 * upstream servers, and register proxy handlers.
 */
export async function handleDownstreamInitialized(
  sessionId: string,
  capabilities: ClientCapabilities,
  config: ServerConfig,
  services: {
    clientManager: IMCPClientManager;
    capabilityStore: ICapabilityStore;
    samplingShim: ISamplingShim | undefined;
    logger: ILogger;
  },
  gatewayServer: MCPGatewayServer,
): Promise<void> {
  const { clientManager, capabilityStore, samplingShim, logger } = services;

  logger.info(
    `Session ${sessionId}: Downstream client initialized with capabilities: ` +
      `sampling=${!!capabilities.sampling}, elicitation=${!!capabilities.elicitation}, roots=${!!capabilities.roots}`,
  );

  // Store capabilities for this session
  capabilityStore.setCapabilities(sessionId, capabilities);

  // Create session-isolated tempdir for sampling shim
  const workingDirectory = createSessionTempDir(sessionId);
  logger.info(
    `Session ${sessionId}: Using tempdir as cwd: ${workingDirectory}`,
  );

  // Store working directory BEFORE initializing shim
  capabilityStore.setWorkingDirectory(sessionId, workingDirectory);

  // Initialize sampling shim if needed (when client lacks full sampling capability)
  const { activeShim, upstreamCapabilities } = await initializeSamplingShim(
    sessionId,
    capabilities,
    samplingShim,
    logger,
  );

  // Register roots provider so the sampling shim can resolve client roots as cwd
  if (capabilities.roots && samplingShim) {
    samplingShim.setRootsProvider(sessionId, () =>
      gatewayServer.forwardListRootsRequest(),
    );
  }

  // Resolve client roots to a local filesystem path for use as stdio server cwd.
  // This ensures stdio servers (e.g. Playwright) use the client's project directory
  // instead of the gateway's working directory.
  let stdioCwd: string | undefined;
  if (capabilities.roots) {
    try {
      const rootsResult = await withTimeout(
        gatewayServer.forwardListRootsRequest(),
        5000,
        "Roots request timed out",
      );
      stdioCwd = findValidLocalRoot(rootsResult.roots);
      if (stdioCwd) {
        logger.info(
          `Session ${sessionId}: Resolved client root as stdio cwd: ${stdioCwd}`,
        );
      } else {
        logger.debug(
          `Session ${sessionId}: No valid local root found, stdio servers will use default cwd`,
        );
      }
    } catch (error) {
      logger.warn(
        `Session ${sessionId}: Failed to resolve client roots for stdio cwd: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Now initialize upstream MCP clients with the (possibly augmented) capabilities
  const initResult = await initializeClientsForSession(
    sessionId,
    config,
    clientManager,
    upstreamCapabilities,
    stdioCwd,
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

  // Register proxy handlers for sampling/elicitation/roots forwarding
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

  // Register roots/list_changed notification forwarding if downstream supports it
  if (capabilities.roots?.listChanged) {
    gatewayServer.registerRootsNotificationForwarding(sessionId);
  }
}
