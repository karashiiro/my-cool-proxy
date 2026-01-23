import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResourceAggregationService } from "./resource-aggregation-service.js";
import type { IMCPClientManager, IMCPClientSession, ILogger } from "./types.js";
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
      expect(result.resources[0]?.uri).toBe("mcp://server1/file:///doc1.md");
      expect(result.resources[1]?.uri).toBe("mcp://server1/file:///doc2.md");
      expect(result.resources[2]?.uri).toBe("mcp://server2/http://api/data");
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
        "mcp://my-server/file:///doc.md",
        "session-123",
      );

      expect(mockClient.readResource).toHaveBeenCalledWith({
        uri: "file:///doc.md",
      });
      expect(result.contents[0]?.uri).toBe("mcp://my-server/file:///doc.md");
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
          "mcp://unknown-server/file:///doc.md",
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
});
