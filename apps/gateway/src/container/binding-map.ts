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
} from "../types/interfaces.js";
import type { MCPGatewayServer } from "../mcp/gateway-server.js";
import type {
  ToolDiscoveryService,
  ResourceAggregationService,
  PromptAggregationService,
  CompletionAggregationService,
  MCPFormatterService,
  IResourceProvider,
  IResourceRoutingService,
} from "@my-cool-proxy/mcp-aggregation";
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
  CompletionAggregationService: CompletionAggregationService;
  ResourceRoutingService: IResourceRoutingService;
  MCPGatewayServer: MCPGatewayServer;
  ShutdownHandler: IShutdownHandler;
  Tool: ITool; // Multi-bound - use getAll() to retrieve all registered tools
  ToolRegistry: IToolRegistry;
  CapabilityStore: ICapabilityStore;
  ServerInfoPreloader: IServerInfoPreloader;
  SkillDiscoveryService: ISkillDiscoveryService;
  SkillResourceProvider: IResourceProvider;
  SamplingShim: ISamplingShim;
  SkillOperationsService: ISkillOperationsService;
}
