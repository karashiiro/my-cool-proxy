/**
 * Dependency injection identifiers for the container.
 * Using string literals instead of symbols for better compatibility with strongly-typed containers.
 */
export const TYPES = {
  LuaRuntime: "LuaRuntime",
  MCPClientManager: "MCPClientManager",
  SessionStore: "SessionStore",
  AuthStrategy: "AuthStrategy",
  ServerConfig: "ServerConfig",
  Logger: "Logger",
  ToolDiscoveryService: "ToolDiscoveryService",
  ResourceAggregationService: "ResourceAggregationService",
  PromptAggregationService: "PromptAggregationService",
  MCPFormatterService: "MCPFormatterService",
  MCPGatewayServer: "MCPGatewayServer",
  ShutdownHandler: "ShutdownHandler",
  CacheService: "CacheService",
  Tool: "Tool",
  ToolRegistry: "ToolRegistry",
  CapabilityStore: "CapabilityStore",
  ServerInfoPreloader: "ServerInfoPreloader",
} as const;
