import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createContainer } from "./inversify.config.js";
import { TYPES } from "../types/index.js";
import type {
  ILogger,
  ILuaRuntime,
  IMCPClientManager,
  IShutdownHandler,
  ICapabilityStore,
  IServerInfoPreloader,
  ISkillDiscoveryService,
  ISamplingShim,
  ServerConfig,
} from "../types/interfaces.js";
import type { ITool } from "../tools/base-tool.js";
import type { IToolRegistry } from "../tools/tool-registry.js";

// Minimal config for basic container tests
const createMinimalConfig = (overrides?: Partial<ServerConfig>): ServerConfig =>
  ({
    port: 3000,
    mcpClients: [],
    ...overrides,
  }) as ServerConfig;

describe("inversify.config", () => {
  let originalQuietLogs: string | undefined;

  beforeEach(() => {
    // Preserve original QUIET_LOGS env
    originalQuietLogs = process.env.QUIET_LOGS;
  });

  afterEach(() => {
    // Restore QUIET_LOGS env
    if (originalQuietLogs === undefined) {
      delete process.env.QUIET_LOGS;
    } else {
      process.env.QUIET_LOGS = originalQuietLogs;
    }
  });

  describe("createContainer", () => {
    it("should create container without throwing", () => {
      const config = createMinimalConfig();
      expect(() => createContainer(config)).not.toThrow();
    });

    it("should bind ServerConfig from provided config", () => {
      const config = createMinimalConfig({ port: 8080 });
      const container = createContainer(config);

      const boundConfig = container.get<ServerConfig>(TYPES.ServerConfig);
      expect(boundConfig).toBe(config);
      expect(boundConfig.port).toBe(8080);
    });
  });

  describe("core services", () => {
    it("should resolve Logger as singleton", () => {
      const container = createContainer(createMinimalConfig());

      const logger1 = container.get<ILogger>(TYPES.Logger);
      const logger2 = container.get<ILogger>(TYPES.Logger);

      expect(logger1).toBeDefined();
      expect(logger1).toBe(logger2); // Same instance (singleton)
      expect(typeof logger1.info).toBe("function");
      expect(typeof logger1.error).toBe("function");
    });

    it("should resolve LuaRuntime as singleton", () => {
      const container = createContainer(createMinimalConfig());

      const runtime1 = container.get<ILuaRuntime>(TYPES.LuaRuntime);
      const runtime2 = container.get<ILuaRuntime>(TYPES.LuaRuntime);

      expect(runtime1).toBeDefined();
      expect(runtime1).toBe(runtime2);
      expect(typeof runtime1.executeScript).toBe("function");
    });

    it("should resolve MCPClientManager as singleton", () => {
      const container = createContainer(createMinimalConfig());

      const manager1 = container.get<IMCPClientManager>(TYPES.MCPClientManager);
      const manager2 = container.get<IMCPClientManager>(TYPES.MCPClientManager);

      expect(manager1).toBeDefined();
      expect(manager1).toBe(manager2);
      expect(typeof manager1.getClientsBySession).toBe("function");
    });

    it("should resolve MCPGatewayServer", () => {
      const container = createContainer(createMinimalConfig());

      const server = container.get(TYPES.MCPGatewayServer);
      expect(server).toBeDefined();
    });

    it("should resolve ShutdownHandler", () => {
      const container = createContainer(createMinimalConfig());

      const handler = container.get<IShutdownHandler>(TYPES.ShutdownHandler);
      expect(handler).toBeDefined();
      expect(typeof handler.shutdown).toBe("function");
    });

    it("should resolve CapabilityStore", () => {
      const container = createContainer(createMinimalConfig());

      const store = container.get<ICapabilityStore>(TYPES.CapabilityStore);
      expect(store).toBeDefined();
    });

    it("should resolve ServerInfoPreloader", () => {
      const container = createContainer(createMinimalConfig());

      const preloader = container.get<IServerInfoPreloader>(
        TYPES.ServerInfoPreloader,
      );
      expect(preloader).toBeDefined();
    });

    it("should resolve SkillDiscoveryService", () => {
      const container = createContainer(createMinimalConfig());

      const service = container.get<ISkillDiscoveryService>(
        TYPES.SkillDiscoveryService,
      );
      expect(service).toBeDefined();
    });
  });

  describe("aggregation services", () => {
    it("should resolve MCPFormatterService", () => {
      const container = createContainer(createMinimalConfig());

      const formatter = container.get(TYPES.MCPFormatterService);
      expect(formatter).toBeDefined();
    });

    it("should resolve ToolDiscoveryService", () => {
      const container = createContainer(createMinimalConfig());

      const service = container.get(TYPES.ToolDiscoveryService);
      expect(service).toBeDefined();
    });

    it("should resolve ResourceAggregationService", () => {
      const container = createContainer(createMinimalConfig());

      const service = container.get(TYPES.ResourceAggregationService);
      expect(service).toBeDefined();
    });

    it("should resolve PromptAggregationService", () => {
      const container = createContainer(createMinimalConfig());

      const service = container.get(TYPES.PromptAggregationService);
      expect(service).toBeDefined();
    });
  });

  describe("core tools", () => {
    it("should register all core MCP tools", () => {
      const container = createContainer(createMinimalConfig());

      const tools = container.getAll<ITool>(TYPES.Tool);
      const toolNames = tools.map((t) => t.name);

      // Core MCP tools that should always be present
      // Note: summary-stats, list-resources, read-resource, invoke-gateway-skill-script,
      // and write-gateway-skill are now Lua builtins (_gateway.* functions), not MCP tools
      expect(toolNames).toContain("execute");
      expect(toolNames).toContain("list-servers");
      expect(toolNames).toContain("list-server-tools");
      expect(toolNames).toContain("tool-details");
      expect(toolNames).toContain("inspect-tool-response");

      // These should NOT be MCP tools anymore
      expect(toolNames).not.toContain("summary-stats");
      expect(toolNames).not.toContain("list-resources");
      expect(toolNames).not.toContain("read-resource");
      expect(toolNames).not.toContain("invoke-gateway-skill-script");
      expect(toolNames).not.toContain("write-gateway-skill");
    });

    it("should resolve ToolRegistry with all tools", () => {
      const container = createContainer(createMinimalConfig());

      const registry = container.get<IToolRegistry>(TYPES.ToolRegistry);
      expect(registry).toBeDefined();

      // Registry should have same tools as direct resolution
      const tools = container.getAll<ITool>(TYPES.Tool);
      for (const tool of tools) {
        const registryTool = registry.get(tool.name);
        expect(registryTool).toBeDefined();
        expect(registryTool?.name).toBe(tool.name);
      }
    });

    it("should have exactly 5 MCP tools", () => {
      const container = createContainer(createMinimalConfig());

      const tools = container.getAll<ITool>(TYPES.Tool);
      expect(tools.length).toBe(5);
    });
  });

  describe("conditional bindings - skills", () => {
    it("should bind SkillResourceProvider when skills enabled", () => {
      const container = createContainer(
        createMinimalConfig({ skills: { enabled: true } }),
      );

      expect(container.isBound(TYPES.SkillResourceProvider)).toBe(true);
    });

    it("should NOT bind SkillResourceProvider when skills disabled", () => {
      const container = createContainer(
        createMinimalConfig({ skills: { enabled: false } }),
      );

      expect(container.isBound(TYPES.SkillResourceProvider)).toBe(false);
    });

    it("should still have same 5 MCP tools regardless of skills config", () => {
      // Skills tools are now Lua builtins, not MCP tools
      const containerDisabled = createContainer(
        createMinimalConfig({ skills: { enabled: false } }),
      );
      const containerEnabled = createContainer(
        createMinimalConfig({ skills: { enabled: true, mutable: true } }),
      );

      const toolsDisabled = containerDisabled.getAll<ITool>(TYPES.Tool);
      const toolsEnabled = containerEnabled.getAll<ITool>(TYPES.Tool);

      expect(toolsDisabled.length).toBe(5);
      expect(toolsEnabled.length).toBe(5);
    });
  });

  describe("conditional bindings - ACP/sampling", () => {
    it("should NOT bind SamplingShim when acp.agent is not configured", () => {
      const container = createContainer(createMinimalConfig());

      expect(container.isBound(TYPES.SamplingShim)).toBe(false);
    });

    it("should bind SamplingShim when acp.agent is configured", () => {
      const container = createContainer(
        createMinimalConfig({
          acp: {
            agent: {
              command: "node",
              args: ["agent.js"],
            },
          },
        }),
      );

      expect(container.isBound(TYPES.SamplingShim)).toBe(true);
      const shim = container.get<ISamplingShim>(TYPES.SamplingShim);
      expect(shim).toBeDefined();
    });
  });

  describe("logger configuration", () => {
    it("should default to info level for console when QUIET_LOGS is not set", () => {
      delete process.env.QUIET_LOGS;
      const container = createContainer(createMinimalConfig());

      const logger = container.get<ILogger>(TYPES.Logger);
      // Logger should be configured - we can verify it exists and works
      expect(logger).toBeDefined();
      expect(() => logger.info("test")).not.toThrow();
    });

    it("should default to warn level for console when QUIET_LOGS is set", () => {
      process.env.QUIET_LOGS = "true";
      const container = createContainer(createMinimalConfig());

      const logger = container.get<ILogger>(TYPES.Logger);
      expect(logger).toBeDefined();
    });

    it("should respect custom logging levels from config", () => {
      const container = createContainer(
        createMinimalConfig({
          logging: {
            console: { level: "debug" },
            file: { level: "trace" },
          },
        }),
      );

      const logger = container.get<ILogger>(TYPES.Logger);
      expect(logger).toBeDefined();
      expect(() => logger.debug("test debug")).not.toThrow();
    });
  });

  describe("ResourceAggregationService provider injection", () => {
    it("should inject SkillResourceProvider into ResourceAggregationService when skills enabled", () => {
      const container = createContainer(
        createMinimalConfig({ skills: { enabled: true } }),
      );

      // Both should be bound
      expect(container.isBound(TYPES.SkillResourceProvider)).toBe(true);
      expect(container.isBound(TYPES.ResourceAggregationService)).toBe(true);

      // Service should resolve without error
      const service = container.get(TYPES.ResourceAggregationService);
      expect(service).toBeDefined();
    });

    it("should work without SkillResourceProvider when skills disabled", () => {
      const container = createContainer(
        createMinimalConfig({ skills: { enabled: false } }),
      );

      expect(container.isBound(TYPES.SkillResourceProvider)).toBe(false);

      // Service should still resolve
      const service = container.get(TYPES.ResourceAggregationService);
      expect(service).toBeDefined();
    });
  });

  describe("container isolation", () => {
    it("should create independent containers for different configs", () => {
      const config1 = createMinimalConfig({ port: 3000 });
      const config2 = createMinimalConfig({ port: 4000 });

      const container1 = createContainer(config1);
      const container2 = createContainer(config2);

      const boundConfig1 = container1.get<ServerConfig>(TYPES.ServerConfig);
      const boundConfig2 = container2.get<ServerConfig>(TYPES.ServerConfig);

      expect(boundConfig1.port).toBe(3000);
      expect(boundConfig2.port).toBe(4000);
    });
  });
});
