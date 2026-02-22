import "reflect-metadata";
import { Container } from "inversify";
import type { TypedContainer } from "@inversifyjs/strongly-typed";
import { TYPES } from "../types/index.js";
import type { ContainerBindingMap } from "./binding-map.js";
import type {
  ILuaRuntime,
  IMCPClientManager,
  ILogger,
  ServerConfig,
  IShutdownHandler,
  ICapabilityStore,
  IServerInfoPreloader,
  ISkillDiscoveryService,
  ISamplingShim,
  ISkillOperationsService,
  IToolInspectionStore,
  IExecutionLog,
} from "../types/interfaces.js";
// Import from workspace packages
import { WasmoonRuntime } from "@my-cool-proxy/lua-runtime";
import { MCPClientManager } from "@my-cool-proxy/mcp-client";
import {
  MCPFormatterService,
  ToolDiscoveryService,
  ResourceAggregationService,
  PromptAggregationService,
  CompletionAggregationService,
  ResourceRoutingService,
  type IResourceProvider,
  type IResourceRoutingService,
} from "@my-cool-proxy/mcp-aggregation";
// Import logger from shared package
import { ConsoleLogger, type LoggerConfig } from "@my-cool-proxy/logger";
import { getGatewayLogPath } from "../utils/log-paths.js";
import { MCPGatewayServer } from "../mcp/gateway-server.js";
import { ShutdownHandler } from "../handlers/shutdown-handler.js";
import { CapabilityStore } from "../services/capability-store.js";
import { ServerInfoPreloader } from "../services/server-info-preloader.js";
import { SkillDiscoveryService } from "../services/skill-discovery-service.js";
import { SkillOperationsService } from "../services/skill-operations-service.js";
import { SkillResourceProvider } from "../services/skill-resource-provider.js";
import { ToolInspectionStore } from "../services/tool-inspection-store.js";
import { NoopExecutionLog } from "../services/noop-execution-log.js";
import { SamplingShim } from "../services/sampling-shim.js";
import type { ITool } from "../tools/base-tool.js";
import { ExecuteLuaTool } from "../tools/execute-lua-tool.js";
import { ListServersTool } from "../tools/list-servers-tool.js";
import { ListServerToolsTool } from "../tools/list-server-tools-tool.js";
import { ToolDetailsTool } from "../tools/tool-details-tool.js";
import { InspectToolResponseTool } from "../tools/inspect-tool-response-tool.js";
import type { IToolRegistry } from "../tools/tool-registry.js";
import { ToolRegistry } from "../tools/tool-registry.js";

export function createContainer(
  config: ServerConfig,
): TypedContainer<ContainerBindingMap> {
  const container = new Container() as TypedContainer<ContainerBindingMap>;

  // Bind configuration
  container.bind<ServerConfig>(TYPES.ServerConfig).toConstantValue(config);

  // Build logger configuration from server config
  // Defaults: console at "info" (or "warn" if QUIET_LOGS is set), file at "trace" (captures everything)
  const quietLogs = process.env.QUIET_LOGS !== undefined;
  const defaultConsoleLevel = quietLogs ? "warn" : "info";

  const loggerConfig: LoggerConfig = {
    console: { level: config.logging?.console?.level ?? defaultConsoleLevel },
    file: {
      level: config.logging?.file?.level ?? "trace",
      path: getGatewayLogPath(),
    },
  };

  // Bind logger (from shared package - use factory binding since ConsoleLogger
  // is DI-framework-agnostic and doesn't have @injectable() decorator)
  container
    .bind<ILogger>(TYPES.Logger)
    .toDynamicValue(() => new ConsoleLogger(loggerConfig))
    .inSingletonScope();

  // Bind Lua runtime (from package - use factory binding)
  container
    .bind<ILuaRuntime>(TYPES.LuaRuntime)
    .toDynamicValue(() => {
      const logger = container.get<ILogger>(TYPES.Logger);
      return new WasmoonRuntime(logger);
    })
    .inSingletonScope();

  // Bind MCP client manager (from package - use factory binding)
  container
    .bind<IMCPClientManager>(TYPES.MCPClientManager)
    .toDynamicValue(() => {
      const logger = container.get<ILogger>(TYPES.Logger);
      return new MCPClientManager(logger);
    })
    .inSingletonScope();

  // Bind resource routing service (from package - use factory binding)
  container
    .bind<IResourceRoutingService>(TYPES.ResourceRoutingService)
    .toDynamicValue(() => {
      const logger = container.get<ILogger>(TYPES.Logger);
      return new ResourceRoutingService(logger);
    })
    .inSingletonScope();

  // Bind MCP aggregation services (from package - use factory bindings)
  container
    .bind(TYPES.MCPFormatterService)
    .toDynamicValue(() => new MCPFormatterService())
    .inSingletonScope();

  container
    .bind(TYPES.ToolDiscoveryService)
    .toDynamicValue(() => {
      const clientManager = container.get<IMCPClientManager>(
        TYPES.MCPClientManager,
      );
      const logger = container.get<ILogger>(TYPES.Logger);
      const luaRuntime = container.get<ILuaRuntime>(TYPES.LuaRuntime);
      const formatter = container.get<MCPFormatterService>(
        TYPES.MCPFormatterService,
      );
      return new ToolDiscoveryService(
        clientManager,
        logger,
        luaRuntime,
        formatter,
      );
    })
    .inSingletonScope();

  container
    .bind(TYPES.ResourceAggregationService)
    .toDynamicValue(() => {
      const clientManager = container.get<IMCPClientManager>(
        TYPES.MCPClientManager,
      );
      const logger = container.get<ILogger>(TYPES.Logger);
      const routingService = container.get<IResourceRoutingService>(
        TYPES.ResourceRoutingService,
      );

      // Collect additional resource providers (e.g., skill resources)
      const providers: IResourceProvider[] = [];
      if (container.isBound(TYPES.SkillResourceProvider)) {
        providers.push(
          container.get<IResourceProvider>(TYPES.SkillResourceProvider),
        );
      }

      return new ResourceAggregationService(
        clientManager,
        logger,
        routingService,
        providers,
      );
    })
    .inSingletonScope();

  container
    .bind(TYPES.PromptAggregationService)
    .toDynamicValue(() => {
      const clientManager = container.get<IMCPClientManager>(
        TYPES.MCPClientManager,
      );
      const logger = container.get<ILogger>(TYPES.Logger);
      const routingService = container.get<IResourceRoutingService>(
        TYPES.ResourceRoutingService,
      );
      return new PromptAggregationService(
        clientManager,
        logger,
        routingService,
      );
    })
    .inSingletonScope();

  container
    .bind(TYPES.CompletionAggregationService)
    .toDynamicValue(() => {
      const clientManager = container.get<IMCPClientManager>(
        TYPES.MCPClientManager,
      );
      const logger = container.get<ILogger>(TYPES.Logger);
      const routingService = container.get<IResourceRoutingService>(
        TYPES.ResourceRoutingService,
      );
      return new CompletionAggregationService(
        clientManager,
        logger,
        routingService,
      );
    })
    .inSingletonScope();

  // Bind core tools (always available)
  // Note: list-resources, read-resource, summary-stats, invoke-gateway-skill-script,
  // and write-gateway-skill are now Lua builtins in the _gateway table, not MCP tools.
  container.bind<ITool>(TYPES.Tool).to(ExecuteLuaTool);
  container.bind<ITool>(TYPES.Tool).to(ListServersTool);
  container.bind<ITool>(TYPES.Tool).to(ListServerToolsTool);
  container.bind<ITool>(TYPES.Tool).to(ToolDetailsTool);
  container.bind<ITool>(TYPES.Tool).to(InspectToolResponseTool);

  // Bind skill resource provider conditionally (exposes skills as MCP resources)
  // The skill tools are now Lua builtins, but we still need the resource provider
  // for native MCP resource access (resources/list, resources/read)
  if (config.skills?.enabled === true) {
    container
      .bind<IResourceProvider>(TYPES.SkillResourceProvider)
      .to(SkillResourceProvider)
      .inSingletonScope();
  }

  // Bind sampling shim conditionally when ACP agent is configured
  if (config.acp?.agent) {
    container
      .bind<ISamplingShim>(TYPES.SamplingShim)
      .toDynamicValue(() => {
        const logger = container.get<ILogger>(TYPES.Logger);
        const capabilityStore = container.get<ICapabilityStore>(
          TYPES.CapabilityStore,
        );
        return new SamplingShim(
          config.acp!.agent!,
          logger,
          capabilityStore,
          config.acp!.filesystem,
          config.acp!.allowOwnTools,
        );
      })
      .inSingletonScope();
  }

  // Bind tool registry and populate it with all registered tools
  container
    .bind<IToolRegistry>(TYPES.ToolRegistry)
    .toDynamicValue(() => {
      const registry = new ToolRegistry();
      const tools = container.getAll<ITool>(TYPES.Tool);

      for (const tool of tools) {
        registry.register(tool);
      }

      return registry;
    })
    .inSingletonScope();

  // Bind gateway server (used directly in index.ts, kept for DI consistency)
  container
    .bind(TYPES.MCPGatewayServer)
    .to(MCPGatewayServer)
    .inSingletonScope();

  // Bind shutdown handler
  container
    .bind<IShutdownHandler>(TYPES.ShutdownHandler)
    .to(ShutdownHandler)
    .inSingletonScope();

  // Bind capability store for tracking downstream client capabilities
  container
    .bind<ICapabilityStore>(TYPES.CapabilityStore)
    .to(CapabilityStore)
    .inSingletonScope();

  // Bind tool inspection store for enforcing tool-details before execute
  container
    .bind<IToolInspectionStore>(TYPES.ToolInspectionStore)
    .to(ToolInspectionStore)
    .inSingletonScope();

  // Bind server info preloader for gathering upstream server info at startup
  container
    .bind<IServerInfoPreloader>(TYPES.ServerInfoPreloader)
    .to(ServerInfoPreloader)
    .inSingletonScope();

  // Bind skill discovery service for loading gateway skills
  container
    .bind<ISkillDiscoveryService>(TYPES.SkillDiscoveryService)
    .to(SkillDiscoveryService)
    .inSingletonScope();

  // Bind skill operations service for executing and writing gateway skills
  container
    .bind<ISkillOperationsService>(TYPES.SkillOperationsService)
    .to(SkillOperationsService)
    .inSingletonScope();

  // Bind no-op execution log by default (rebound to SQLite in startHttpMode/startStdioMode)
  container
    .bind<IExecutionLog>(TYPES.ExecutionLog)
    .to(NoopExecutionLog)
    .inSingletonScope();

  return container;
}
