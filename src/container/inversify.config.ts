import "reflect-metadata";
import { Container } from "inversify";
import { TYPES } from "../types/index.js";
import type {
  ILuaRuntime,
  IMCPClientManager,
  ITransportManager,
  ILogger,
  ServerConfig,
  IMCPSessionController,
  IShutdownHandler,
} from "../types/interfaces.js";
import { WasmoonRuntime } from "../lua/runtime.js";
import { MCPClientManager } from "../mcp/client-manager.js";
import { TransportManager } from "../mcp/transport-manager.js";
import { ConsoleLogger } from "../utils/logger.js";
import { MCPGatewayServer } from "../mcp/gateway-server.js";
import { ToolDiscoveryService } from "../mcp/tool-discovery-service.js";
import { ResourceAggregationService } from "../mcp/resource-aggregation-service.js";
import { PromptAggregationService } from "../mcp/prompt-aggregation-service.js";
import { MCPFormatterService } from "../mcp/mcp-formatter-service.js";
import { MCPSessionController } from "../controllers/mcp-session-controller.js";
import { ShutdownHandler } from "../handlers/shutdown-handler.js";

export function createContainer(config: ServerConfig): Container {
  const container = new Container();

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

  // Bind transport manager
  container
    .bind<ITransportManager>(TYPES.TransportManager)
    .to(TransportManager)
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

  // Bind gateway server (singleton - shared across all sessions)
  container
    .bind(TYPES.MCPGatewayServer)
    .to(MCPGatewayServer)
    .inSingletonScope();

  // Bind session controller
  container
    .bind<IMCPSessionController>(TYPES.MCPSessionController)
    .to(MCPSessionController)
    .inSingletonScope();

  // Bind shutdown handler
  container
    .bind<IShutdownHandler>(TYPES.ShutdownHandler)
    .to(ShutdownHandler)
    .inSingletonScope();

  return container;
}
