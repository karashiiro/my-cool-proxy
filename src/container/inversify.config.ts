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
} from "../types/interfaces.js";
import { WasmoonRuntime } from "../lua/runtime.js";
import { MCPClientManager } from "../mcp/client-manager.js";
import { ConsoleLogger } from "../utils/logger.js";
import { MCPGatewayServer } from "../mcp/gateway-server.js";
import { ToolDiscoveryService } from "../mcp/tool-discovery-service.js";
import { ResourceAggregationService } from "../mcp/resource-aggregation-service.js";
import { PromptAggregationService } from "../mcp/prompt-aggregation-service.js";
import { MCPFormatterService } from "../mcp/mcp-formatter-service.js";
import { ShutdownHandler } from "../handlers/shutdown-handler.js";
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

  // Bind logger
  container.bind<ILogger>(TYPES.Logger).to(ConsoleLogger).inSingletonScope();

  // Bind Lua runtime
  container
    .bind<ILuaRuntime>(TYPES.LuaRuntime)
    .to(WasmoonRuntime)
    .inSingletonScope();

  // Bind MCP client manager
  container
    .bind<IMCPClientManager>(TYPES.MCPClientManager)
    .to(MCPClientManager)
    .inSingletonScope();

  // Bind refactored MCP services
  container
    .bind(TYPES.MCPFormatterService)
    .to(MCPFormatterService)
    .inSingletonScope();
  container
    .bind(TYPES.ToolDiscoveryService)
    .to(ToolDiscoveryService)
    .inSingletonScope();
  container
    .bind(TYPES.ResourceAggregationService)
    .to(ResourceAggregationService)
    .inSingletonScope();
  container
    .bind(TYPES.PromptAggregationService)
    .to(PromptAggregationService)
    .inSingletonScope();

  // Bind all tools
  container.bind<ITool>(TYPES.Tool).to(ExecuteLuaTool);
  container.bind<ITool>(TYPES.Tool).to(ListServersTool);
  container.bind<ITool>(TYPES.Tool).to(ListServerToolsTool);
  container.bind<ITool>(TYPES.Tool).to(ToolDetailsTool);
  container.bind<ITool>(TYPES.Tool).to(InspectToolResponseTool);

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

  return container;
}
