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
} from "../types/interfaces.js";
// Import from workspace packages
import { WasmoonRuntime } from "@my-cool-proxy/lua-runtime";
import { MCPClientManager } from "@my-cool-proxy/mcp-client";
import {
  MCPFormatterService,
  ToolDiscoveryService,
  ResourceAggregationService,
  PromptAggregationService,
} from "@my-cool-proxy/mcp-aggregation";
// Import gateway-specific services
import { ConsoleLogger } from "../utils/logger.js";
import { MCPGatewayServer } from "../mcp/gateway-server.js";
import { ShutdownHandler } from "../handlers/shutdown-handler.js";
import { CapabilityStore } from "../services/capability-store.js";
import { ServerInfoPreloader } from "../services/server-info-preloader.js";
import { SkillDiscoveryService } from "../services/skill-discovery-service.js";
import type { ITool } from "../tools/base-tool.js";
import { ExecuteLuaTool } from "../tools/execute-lua-tool.js";
import { ListServersTool } from "../tools/list-servers-tool.js";
import { ListServerToolsTool } from "../tools/list-server-tools-tool.js";
import { ToolDetailsTool } from "../tools/tool-details-tool.js";
import { InspectToolResponseTool } from "../tools/inspect-tool-response-tool.js";
import { SummaryStatsTool } from "../tools/summary-stats-tool.js";
import { LoadGatewaySkillTool } from "../tools/load-gateway-skill-tool.js";
import type { IToolRegistry } from "../tools/tool-registry.js";
import { ToolRegistry } from "../tools/tool-registry.js";

export function createContainer(
  config: ServerConfig,
): TypedContainer<ContainerBindingMap> {
  const container = new Container() as TypedContainer<ContainerBindingMap>;

  // Bind configuration
  container.bind<ServerConfig>(TYPES.ServerConfig).toConstantValue(config);

  // Bind logger (gateway-specific, keeps Inversify decorator)
  container.bind<ILogger>(TYPES.Logger).to(ConsoleLogger).inSingletonScope();

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
      return new ResourceAggregationService(clientManager, logger);
    })
    .inSingletonScope();

  container
    .bind(TYPES.PromptAggregationService)
    .toDynamicValue(() => {
      const clientManager = container.get<IMCPClientManager>(
        TYPES.MCPClientManager,
      );
      const logger = container.get<ILogger>(TYPES.Logger);
      return new PromptAggregationService(clientManager, logger);
    })
    .inSingletonScope();

  // Bind all tools
  container.bind<ITool>(TYPES.Tool).to(ExecuteLuaTool);
  container.bind<ITool>(TYPES.Tool).to(ListServersTool);
  container.bind<ITool>(TYPES.Tool).to(ListServerToolsTool);
  container.bind<ITool>(TYPES.Tool).to(ToolDetailsTool);
  container.bind<ITool>(TYPES.Tool).to(InspectToolResponseTool);
  container.bind<ITool>(TYPES.Tool).to(SummaryStatsTool);
  container.bind<ITool>(TYPES.Tool).to(LoadGatewaySkillTool);

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

  return container;
}
