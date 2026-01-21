import type {
  ILuaRuntime,
  IMCPClientManager,
  ILogger,
  ServerConfig,
  IShutdownHandler,
  ICapabilityStore,
  IServerInfoPreloader,
} from "../types/interfaces.js";
import type { MCPGatewayServer } from "../mcp/gateway-server.js";
import type { ToolDiscoveryService } from "../mcp/tool-discovery-service.js";
import type { ResourceAggregationService } from "../mcp/resource-aggregation-service.js";
import type { PromptAggregationService } from "../mcp/prompt-aggregation-service.js";
import type { MCPFormatterService } from "../mcp/mcp-formatter-service.js";
import type { ITool } from "../tools/base-tool.js";
import type { IToolRegistry } from "../tools/tool-registry.js";

/**
 * Binding map that defines all services available in the DI container.
 * This provides compile-time type safety for dependency injection.
 */
export interface ContainerBindingMap {
  ServerConfig: ServerConfig;
  Logger: ILogger;
  LuaRuntime: ILuaRuntime;
  MCPClientManager: IMCPClientManager;
  MCPFormatterService: MCPFormatterService;
  ToolDiscoveryService: ToolDiscoveryService;
  ResourceAggregationService: ResourceAggregationService;
  PromptAggregationService: PromptAggregationService;
  MCPGatewayServer: MCPGatewayServer;
  ShutdownHandler: IShutdownHandler;
  Tool: ITool; // Multi-bound - use getAll() to retrieve all registered tools
  ToolRegistry: IToolRegistry;
  CapabilityStore: ICapabilityStore;
  ServerInfoPreloader: IServerInfoPreloader;
}
