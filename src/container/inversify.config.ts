import "reflect-metadata";
import { Container } from "inversify";
import { TYPES } from "../types/index.js";
import type {
  ILuaRuntime,
  IMCPClientManager,
  ITransportManager,
  ILogger,
  ServerConfig,
} from "../types/interfaces.js";
import { WasmoonRuntime } from "../lua/runtime.js";
import { MCPClientManager } from "../mcp/client-manager.js";
import { TransportManager } from "../mcp/transport-manager.js";
import { ConsoleLogger } from "../utils/logger.js";

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

  return container;
}
