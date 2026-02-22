import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResourceAggregationService } from "./resource-aggregation-service.js";
import type {
  IMCPClientManager,
  IMCPClientSession,
  ILogger,
  IResourceProvider,
} from "./types.js";
import type { IResourceRoutingService } from "./resource-routing-service.js";
import type {
  Resource,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";

// Mock logger factory
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
});

// Mock routing service factory
const createMockRoutingService = (): IResourceRoutingService => ({
  registerUri: vi.fn(),
  registerTemplate: vi.fn(),
  registerEncounteredUri: vi.fn(),
  getServerForUri: vi.fn(),
  invalidateSession: vi.fn(),
  deleteSession: vi.fn(),
});

// Mock client session factory
function createMockClientSession(options: {
  resources?: Resource[];
  readResult?: ReadResourceResult;
}): IMCPClientSession {
  return {
    listTools: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue(options.resources ?? []),
    readResource: vi
      .fn()
      .mockResolvedValue(options.readResult ?? { contents: [] }),
    listPrompts: vi.fn().mockResolvedValue([]),
    getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
    getServerVersion: vi.fn().mockReturnValue({}),
    getInstructions: vi.fn().mockReturnValue(undefined),
    listResourceTemplates: vi.fn().mockResolvedValue([]),
    complete: vi.fn().mockResolvedValue({ completion: { values: [] } }),
  };
}

describe("ResourceAggregationService", () => {
  let service: ResourceAggregationService;
  let mockClientManager: IMCPClientManager;
  let mockLogger: ILogger;
  let mockRoutingService: IResourceRoutingService;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockRoutingService = createMockRoutingService();
    mockClientManager = {
      getClientsBySession: vi.fn().mockReturnValue(new Map()),
      getFailedServers: vi.fn().mockReturnValue(new Map()),
    };

    service = new ResourceAggregationService(
      mockClientManager,
      mockLogger,
      mockRoutingService,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("listResources", () => {
    it("should aggregate resources from multiple servers with original URIs", async () => {
      const server1Resources: Resource[] = [
        { uri: "file:///doc1.md", name: "Doc 1" },
        { uri: "file:///doc2.md", name: "Doc 2" },
      ];
      const server2Resources: Resource[] = [
        { uri: "http://api/data", name: "API Data" },
      ];

      const mockClient1 = createMockClientSession({
        resources: server1Resources,
      });
      const mockClient2 = createMockClientSession({
        resources: server2Resources,
      });

      const clientsMap = new Map([
        ["server1", mockClient1],
        ["server2", mockClient2],
      ]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const result = await service.listResources("session-123");

      expect(result.resources).toHaveLength(3);
      // URIs should be passed through unchanged (no gw:// namespacing)
      expect(result.resources[0]?.uri).toBe("file:///doc1.md");
      expect(result.resources[1]?.uri).toBe("file:///doc2.md");
      expect(result.resources[2]?.uri).toBe("http://api/data");
    });

    it("should register routes for each resource", async () => {
      const resources: Resource[] = [{ uri: "file:///doc.md", name: "Doc" }];
      const mockClient = createMockClientSession({ resources });
      const clientsMap = new Map([["my-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      await service.listResources("session-123");

      expect(mockRoutingService.registerUri).toHaveBeenCalledWith(
        "session-123",
        "file:///doc.md",
        "my-server",
      );
    });

    it("should return empty array when no clients available", async () => {
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        new Map(),
      );

      const result = await service.listResources("session-123");

      expect(result.resources).toEqual([]);
    });

    it("should use 'default' session when sessionId is empty", async () => {
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        new Map(),
      );

      await service.listResources("");

      expect(mockClientManager.getClientsBySession).toHaveBeenCalledWith(
        "default",
      );
    });

    it("should cache results", async () => {
      const resources: Resource[] = [
        { uri: "file:///cached.txt", name: "Cached" },
      ];
      const mockClient = createMockClientSession({ resources });

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      await service.listResources("session-123");
      await service.listResources("session-123");

      expect(mockClient.listResources).toHaveBeenCalledTimes(1);
    });

    it("should handle server errors gracefully", async () => {
      const workingResources: Resource[] = [
        { uri: "file:///working.txt", name: "Working" },
      ];
      const mockWorkingClient = createMockClientSession({
        resources: workingResources,
      });
      const mockFailingClient = createMockClientSession({});
      vi.mocked(mockFailingClient.listResources).mockRejectedValue(
        new Error("Connection lost"),
      );

      const clientsMap = new Map([
        ["working-server", mockWorkingClient],
        ["failing-server", mockFailingClient],
      ]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const result = await service.listResources("session-123");

      expect(result.resources).toHaveLength(1);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("readResource", () => {
    it("should read a resource from the correct server via routing", async () => {
      const mockResult: ReadResourceResult = {
        contents: [
          {
            uri: "file:///doc.md",
            mimeType: "text/markdown",
            text: "# Hello World",
          },
        ],
      };
      const mockClient = createMockClientSession({ readResult: mockResult });

      const clientsMap = new Map([["my-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );
      vi.mocked(mockRoutingService.getServerForUri).mockReturnValue(
        "my-server",
      );

      const result = await service.readResource(
        "file:///doc.md",
        "session-123",
      );

      expect(mockRoutingService.getServerForUri).toHaveBeenCalledWith(
        "session-123",
        "file:///doc.md",
      );
      expect(mockClient.readResource).toHaveBeenCalledWith({
        uri: "file:///doc.md",
      });
      // URI should be returned unchanged (no namespacing)
      expect(result.contents[0]?.uri).toBe("file:///doc.md");
    });

    it("should register content URIs as encountered", async () => {
      const mockResult: ReadResourceResult = {
        contents: [
          {
            uri: "file:///doc.md",
            mimeType: "text/markdown",
            text: "# Hello",
          },
        ],
      };
      const mockClient = createMockClientSession({ readResult: mockResult });
      const clientsMap = new Map([["my-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );
      vi.mocked(mockRoutingService.getServerForUri).mockReturnValue(
        "my-server",
      );

      await service.readResource("file:///doc.md", "session-123");

      expect(mockRoutingService.registerEncounteredUri).toHaveBeenCalledWith(
        "session-123",
        "file:///doc.md",
        "my-server",
      );
    });

    it("should throw error when no route found for URI", async () => {
      vi.mocked(mockRoutingService.getServerForUri).mockReturnValue(undefined);

      await expect(
        service.readResource("file:///unknown.md", "session-123"),
      ).rejects.toThrow("No route found for resource URI");
    });

    it("should throw error when server not found in client pool", async () => {
      vi.mocked(mockRoutingService.getServerForUri).mockReturnValue(
        "missing-server",
      );
      const clientsMap = new Map([
        ["other-server", createMockClientSession({})],
      ]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      await expect(
        service.readResource("file:///doc.md", "session-123"),
      ).rejects.toThrow("not found");
    });
  });

  describe("listResourceTemplates", () => {
    it("should aggregate templates from multiple servers with original URIs", async () => {
      const mockClient1 = createMockClientSession({});
      vi.mocked(mockClient1.listResourceTemplates).mockResolvedValue([
        { uriTemplate: "deployment://{region}/{service}", name: "deployment" },
      ]);
      const mockClient2 = createMockClientSession({});
      vi.mocked(mockClient2.listResourceTemplates).mockResolvedValue([
        { uriTemplate: "log://{date}", name: "log" },
        { uriTemplate: "metric://{name}", name: "metric" },
      ]);

      const clientsMap = new Map([
        ["server1", mockClient1],
        ["server2", mockClient2],
      ]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const result = await service.listResourceTemplates("session-123");

      expect(result.resourceTemplates).toHaveLength(3);
      // Templates should be passed through unchanged (no gw:// namespacing)
      expect(result.resourceTemplates[0]?.uriTemplate).toBe(
        "deployment://{region}/{service}",
      );
      expect(result.resourceTemplates[1]?.uriTemplate).toBe("log://{date}");
      expect(result.resourceTemplates[2]?.uriTemplate).toBe("metric://{name}");
    });

    it("should register routes for each template", async () => {
      const mockClient = createMockClientSession({});
      vi.mocked(mockClient.listResourceTemplates).mockResolvedValue([
        { uriTemplate: "deployment://{region}/{service}", name: "deployment" },
      ]);

      const clientsMap = new Map([["my-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      await service.listResourceTemplates("session-123");

      expect(mockRoutingService.registerTemplate).toHaveBeenCalledWith(
        "session-123",
        "deployment://{region}/{service}",
        "my-server",
      );
    });

    it("should return empty array when no clients available", async () => {
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        new Map(),
      );

      const result = await service.listResourceTemplates("session-123");

      expect(result.resourceTemplates).toEqual([]);
    });

    it("should use 'default' session when sessionId is empty", async () => {
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        new Map(),
      );

      await service.listResourceTemplates("");

      expect(mockClientManager.getClientsBySession).toHaveBeenCalledWith(
        "default",
      );
    });

    it("should cache results", async () => {
      const mockClient = createMockClientSession({});
      vi.mocked(mockClient.listResourceTemplates).mockResolvedValue([
        { uriTemplate: "cached://{id}", name: "cached" },
      ]);

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      await service.listResourceTemplates("session-123");
      await service.listResourceTemplates("session-123");

      expect(mockClient.listResourceTemplates).toHaveBeenCalledTimes(1);
    });

    it("should handle server errors gracefully", async () => {
      const mockWorkingClient = createMockClientSession({});
      vi.mocked(mockWorkingClient.listResourceTemplates).mockResolvedValue([
        { uriTemplate: "working://{id}", name: "working" },
      ]);
      const mockFailingClient = createMockClientSession({});
      vi.mocked(mockFailingClient.listResourceTemplates).mockRejectedValue(
        new Error("Connection lost"),
      );

      const clientsMap = new Map([
        ["working-server", mockWorkingClient],
        ["failing-server", mockFailingClient],
      ]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const result = await service.listResourceTemplates("session-123");

      expect(result.resourceTemplates).toHaveLength(1);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should gracefully handle 'Server does not support' errors", async () => {
      const mockClient = createMockClientSession({});
      vi.mocked(mockClient.listResourceTemplates).mockRejectedValue(
        new Error("Server does not support resource templates"),
      );

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const result = await service.listResourceTemplates("session-123");

      expect(result.resourceTemplates).toEqual([]);
      // Should NOT log an error for "Server does not support" - it's expected
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe("handleResourceListChanged", () => {
    it("should invalidate cache and routing for the session", async () => {
      const resources: Resource[] = [{ uri: "cached.txt", name: "Cached" }];
      const mockClient = createMockClientSession({ resources });

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      // Populate cache
      await service.listResources("session-123");
      expect(mockClient.listResources).toHaveBeenCalledTimes(1);

      // Invalidate cache
      service.handleResourceListChanged("server1", "session-123");

      // Should invalidate routing
      expect(mockRoutingService.invalidateSession).toHaveBeenCalledWith(
        "session-123",
      );

      // Should fetch again
      await service.listResources("session-123");
      expect(mockClient.listResources).toHaveBeenCalledTimes(2);
    });

    it("should also invalidate template cache for the session", async () => {
      const mockClient = createMockClientSession({});
      vi.mocked(mockClient.listResourceTemplates).mockResolvedValue([
        { uriTemplate: "cached://{id}", name: "cached" },
      ]);

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      // Populate template cache
      await service.listResourceTemplates("session-123");
      expect(mockClient.listResourceTemplates).toHaveBeenCalledTimes(1);

      // Invalidate cache
      service.handleResourceListChanged("server1", "session-123");

      // Should fetch again
      await service.listResourceTemplates("session-123");
      expect(mockClient.listResourceTemplates).toHaveBeenCalledTimes(2);
    });
  });

  describe("additional resource providers", () => {
    const createMockProvider = (
      resources: Resource[],
      uriPrefix: string,
    ): IResourceProvider => ({
      listResources: vi.fn().mockResolvedValue(resources),
      readResource: vi.fn().mockImplementation(async (uri: string) => {
        if (uri.startsWith(uriPrefix)) {
          return {
            contents: [
              { uri, text: `Content for ${uri}`, mimeType: "text/plain" },
            ],
          };
        }
        return null;
      }),
      handlesUri: vi
        .fn()
        .mockImplementation((uri: string) => uri.startsWith(uriPrefix)),
    });

    it("should include resources from additional providers in listResources", async () => {
      const mcpResources: Resource[] = [
        { uri: "file:///mcp-doc.md", name: "MCP Doc" },
      ];
      const providerResources: Resource[] = [
        { uri: "gw-skill://my-skill", name: "My Skill" },
      ];

      const mockClient = createMockClientSession({ resources: mcpResources });
      const mockProvider = createMockProvider(providerResources, "gw-skill://");

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const serviceWithProvider = new ResourceAggregationService(
        mockClientManager,
        mockLogger,
        mockRoutingService,
        [mockProvider],
      );

      const result = await serviceWithProvider.listResources("session-123");

      expect(result.resources).toHaveLength(2);
      // MCP resource URI is unchanged (no gw:// namespacing)
      expect(result.resources[0]?.uri).toBe("file:///mcp-doc.md");
      expect(result.resources[1]?.uri).toBe("gw-skill://my-skill");
    });

    it("should route readResource to provider when handlesUri returns true", async () => {
      const mockProvider = createMockProvider([], "gw-skill://");
      const mockClient = createMockClientSession({});
      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const serviceWithProvider = new ResourceAggregationService(
        mockClientManager,
        mockLogger,
        mockRoutingService,
        [mockProvider],
      );

      const result = await serviceWithProvider.readResource(
        "gw-skill://my-skill/scripts/run.py",
        "session-123",
      );

      expect(mockProvider.handlesUri).toHaveBeenCalledWith(
        "gw-skill://my-skill/scripts/run.py",
      );
      expect(mockProvider.readResource).toHaveBeenCalledWith(
        "gw-skill://my-skill/scripts/run.py",
      );
      const content = result.contents[0] as { text?: string };
      expect(content?.text).toBe(
        "Content for gw-skill://my-skill/scripts/run.py",
      );
      expect(mockClient.readResource).not.toHaveBeenCalled();
    });

    it("should fall back to routing service when no provider handles the URI", async () => {
      const mcpResult: ReadResourceResult = {
        contents: [
          {
            uri: "file:///doc.md",
            text: "MCP content",
            mimeType: "text/plain",
          },
        ],
      };
      const mockProvider = createMockProvider([], "gw-skill://");
      const mockClient = createMockClientSession({ readResult: mcpResult });
      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );
      vi.mocked(mockRoutingService.getServerForUri).mockReturnValue("server1");

      const serviceWithProvider = new ResourceAggregationService(
        mockClientManager,
        mockLogger,
        mockRoutingService,
        [mockProvider],
      );

      const result = await serviceWithProvider.readResource(
        "file:///doc.md",
        "session-123",
      );

      expect(mockProvider.handlesUri).toHaveBeenCalledWith("file:///doc.md");
      expect(mockProvider.readResource).not.toHaveBeenCalled();
      expect(mockClient.readResource).toHaveBeenCalledWith({
        uri: "file:///doc.md",
      });
      const content = result.contents[0] as { text?: string };
      expect(content?.text).toBe("MCP content");
    });

    it("should handle provider errors gracefully in listResources", async () => {
      const failingProvider: IResourceProvider = {
        listResources: vi.fn().mockRejectedValue(new Error("Provider failed")),
        readResource: vi.fn(),
        handlesUri: vi.fn().mockReturnValue(false),
      };

      const mockClient = createMockClientSession({
        resources: [{ uri: "file:///doc.md", name: "Doc" }],
      });
      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const serviceWithProvider = new ResourceAggregationService(
        mockClientManager,
        mockLogger,
        mockRoutingService,
        [failingProvider],
      );

      const result = await serviceWithProvider.listResources("session-123");

      expect(result.resources).toHaveLength(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to list resources from additional provider:",
        expect.any(Error),
      );
    });

    it("should work with empty providers array (backwards compatible)", async () => {
      const resources: Resource[] = [{ uri: "file:///doc.md", name: "Doc" }];
      const mockClient = createMockClientSession({ resources });
      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const serviceNoProviders = new ResourceAggregationService(
        mockClientManager,
        mockLogger,
        mockRoutingService,
        [],
      );

      const result = await serviceNoProviders.listResources("session-123");

      expect(result.resources).toHaveLength(1);
      // URI should be unchanged
      expect(result.resources[0]?.uri).toBe("file:///doc.md");
    });
  });
});
