import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResourceAggregationService } from "./resource-aggregation-service.js";
import type {
  IMCPClientManager,
  IMCPClientSession,
  ILogger,
  IResourceProvider,
} from "./types.js";
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
  };
}

describe("ResourceAggregationService", () => {
  let service: ResourceAggregationService;
  let mockClientManager: IMCPClientManager;
  let mockLogger: ILogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockClientManager = {
      getClientsBySession: vi.fn().mockReturnValue(new Map()),
      getFailedServers: vi.fn().mockReturnValue(new Map()),
    };

    service = new ResourceAggregationService(mockClientManager, mockLogger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("listResources", () => {
    it("should aggregate resources from multiple servers", async () => {
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
      expect(result.resources[0]?.uri).toBe("gw://server1/file:///doc1.md");
      expect(result.resources[1]?.uri).toBe("gw://server1/file:///doc2.md");
      expect(result.resources[2]?.uri).toBe("gw://server2/http://api/data");
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
    it("should read a resource from the correct server", async () => {
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

      const result = await service.readResource(
        "gw://my-server/file:///doc.md",
        "session-123",
      );

      expect(mockClient.readResource).toHaveBeenCalledWith({
        uri: "file:///doc.md",
      });
      expect(result.contents[0]?.uri).toBe("gw://my-server/file:///doc.md");
    });

    it("should throw error for invalid URI format", async () => {
      await expect(
        service.readResource("http://example.com/resource", "session-123"),
      ).rejects.toThrow("Invalid resource URI format");
    });

    it("should throw error when server not found", async () => {
      const mockClient = createMockClientSession({});
      const clientsMap = new Map([["other-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      await expect(
        service.readResource(
          "gw://unknown-server/file:///doc.md",
          "session-123",
        ),
      ).rejects.toThrow("not found");
    });
  });

  describe("handleResourceListChanged", () => {
    it("should invalidate cache for the session", async () => {
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

      // Should fetch again
      await service.listResources("session-123");
      expect(mockClient.listResources).toHaveBeenCalledTimes(2);
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
        [mockProvider],
      );

      const result = await serviceWithProvider.listResources("session-123");

      expect(result.resources).toHaveLength(2);
      expect(result.resources[0]?.uri).toBe("gw://server1/file:///mcp-doc.md");
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

    it("should fall back to MCP server routing when no provider handles the URI", async () => {
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

      const serviceWithProvider = new ResourceAggregationService(
        mockClientManager,
        mockLogger,
        [mockProvider],
      );

      const result = await serviceWithProvider.readResource(
        "gw://server1/file:///doc.md",
        "session-123",
      );

      expect(mockProvider.handlesUri).toHaveBeenCalledWith(
        "gw://server1/file:///doc.md",
      );
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
        [],
      );

      const result = await serviceNoProviders.listResources("session-123");

      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]?.uri).toBe("gw://server1/file:///doc.md");
    });
  });
});
