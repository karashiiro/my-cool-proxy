import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TestBed } from "@suites/unit";
import { ResourceAggregationService } from "./resource-aggregation-service.js";
import { TYPES } from "../types/index.js";
import type { MCPClientSession } from "./client-session.js";
import type {
  Resource,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";

describe("ResourceAggregationService", () => {
  let service: ResourceAggregationService;
  let mockClientManager: ReturnType<typeof unitRef.get>;
  let mockLogger: ReturnType<typeof unitRef.get>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let unitRef: any;

  beforeEach(async () => {
    const { unit, unitRef: ref } = await TestBed.solitary(
      ResourceAggregationService,
    ).compile();
    service = unit;
    unitRef = ref;
    mockClientManager = unitRef.get(TYPES.MCPClientManager);
    mockLogger = unitRef.get(TYPES.Logger);
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

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient1 as unknown as MCPClientSession],
        ["server2", mockClient2 as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listResources("session-123");

      expect(result.resources).toHaveLength(3);
      expect(result.resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ uri: "mcp://server1/file:///doc1.md" }),
          expect.objectContaining({ uri: "mcp://server1/file:///doc2.md" }),
          expect.objectContaining({ uri: "mcp://server2/http://api/data" }),
        ]),
      );
    });

    it("should return empty array when no clients available", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listResources("session-123");

      expect(result.resources).toEqual([]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        "No clients available for session 'session-123'",
      );
    });

    it("should use 'default' session when sessionId is empty", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await service.listResources("");

      expect(mockClientManager.getClientsBySession).toHaveBeenCalledWith(
        "default",
      );
    });

    it("should cache results and return cached resources on subsequent calls", async () => {
      const serverResources: Resource[] = [
        { uri: "file:///cached.txt", name: "Cached" },
      ];
      const mockClient = createMockClientSession({
        resources: serverResources,
      });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      // First call - should fetch from clients
      const result1 = await service.listResources("session-123");

      // Second call - should return cached
      const result2 = await service.listResources("session-123");

      expect(mockClient.listResources).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(result2);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Returning cached resource list for session 'session-123'",
      );
    });

    it("should handle server errors gracefully and continue aggregation", async () => {
      const workingResources: Resource[] = [
        { uri: "file:///working.txt", name: "Working" },
      ];
      const mockWorkingClient = createMockClientSession({
        resources: workingResources,
      });
      const mockFailingClient = createMockClientSession({});
      mockFailingClient.listResources.mockRejectedValue(
        new Error("Connection lost"),
      );

      const clientsMap = new Map<string, MCPClientSession>([
        ["working-server", mockWorkingClient as unknown as MCPClientSession],
        ["failing-server", mockFailingClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listResources("session-123");

      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]!.uri).toBe(
        "mcp://working-server/file:///working.txt",
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to list resources from server 'failing-server':",
        expect.any(Error),
      );
    });

    it("should silently ignore 'Server does not support resources' errors", async () => {
      const mockClient = createMockClientSession({});
      mockClient.listResources.mockRejectedValue(
        new Error("Server does not support resources"),
      );

      const clientsMap = new Map<string, MCPClientSession>([
        ["no-resources-server", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listResources("session-123");

      expect(result.resources).toEqual([]);
      // Should NOT log error for this specific case
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("should namespace resources with mcp:// URI format", async () => {
      const serverResources: Resource[] = [
        {
          uri: "file:///path/to/file.txt",
          name: "My File",
          description: "A file",
          mimeType: "text/plain",
        },
      ];
      const mockClient = createMockClientSession({
        resources: serverResources,
      });

      const clientsMap = new Map<string, MCPClientSession>([
        ["my-server", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listResources("session-123");

      expect(result.resources[0]).toEqual({
        uri: "mcp://my-server/file:///path/to/file.txt",
        name: "My File",
        description: "A file",
        mimeType: "text/plain",
      });
    });

    it("should log aggregation info after successful fetch", async () => {
      const serverResources: Resource[] = [
        { uri: "res1", name: "R1" },
        { uri: "res2", name: "R2" },
      ];
      const mockClient = createMockClientSession({
        resources: serverResources,
      });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await service.listResources("session-123");

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Aggregated 2 resources from 1 servers for session 'session-123'",
      );
    });

    it("should handle concurrent resource fetches from multiple servers", async () => {
      const resources1: Resource[] = [{ uri: "r1", name: "R1" }];
      const resources2: Resource[] = [{ uri: "r2", name: "R2" }];
      const resources3: Resource[] = [{ uri: "r3", name: "R3" }];

      const mockClient1 = createMockClientSession({ resources: resources1 });
      const mockClient2 = createMockClientSession({ resources: resources2 });
      const mockClient3 = createMockClientSession({ resources: resources3 });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient1 as unknown as MCPClientSession],
        ["server2", mockClient2 as unknown as MCPClientSession],
        ["server3", mockClient3 as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listResources("session-123");

      expect(result.resources).toHaveLength(3);
      expect(mockClient1.listResources).toHaveBeenCalled();
      expect(mockClient2.listResources).toHaveBeenCalled();
      expect(mockClient3.listResources).toHaveBeenCalled();
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

      const clientsMap = new Map<string, MCPClientSession>([
        ["my-server", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.readResource(
        "mcp://my-server/file:///doc.md",
        "session-123",
      );

      expect(mockClient.readResource).toHaveBeenCalledWith({
        uri: "file:///doc.md",
      });
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]!.uri).toBe("mcp://my-server/file:///doc.md");
    });

    it("should throw error for invalid URI format - missing mcp prefix", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await expect(
        service.readResource("http://example.com/resource", "session-123"),
      ).rejects.toThrow(
        "Invalid resource URI format: 'http://example.com/resource'. Expected format: mcp://{server-name}/{uri}",
      );
    });

    it("should throw error for invalid URI format - no slash after server", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await expect(
        service.readResource("mcp://server-only", "session-123"),
      ).rejects.toThrow("Invalid resource URI format");
    });

    it("should throw error when server not found", async () => {
      const mockClient = createMockClientSession({});
      const clientsMap = new Map<string, MCPClientSession>([
        ["other-server", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await expect(
        service.readResource(
          "mcp://unknown-server/file:///doc.md",
          "session-123",
        ),
      ).rejects.toThrow(
        "Server 'unknown-server' not found in session 'session-123'. Available servers: other-server",
      );
    });

    it("should throw error when no servers available", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await expect(
        service.readResource("mcp://unknown/file:///doc.md", "session-123"),
      ).rejects.toThrow("Available servers: none");
    });

    it("should use 'default' session when sessionId is empty", async () => {
      const mockResult: ReadResourceResult = {
        contents: [{ uri: "file:///doc.md", text: "content" }],
      };
      const mockClient = createMockClientSession({ readResult: mockResult });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await service.readResource("mcp://server1/file:///doc.md", "");

      expect(mockClientManager.getClientsBySession).toHaveBeenCalledWith(
        "default",
      );
    });

    it("should namespace URIs in all content blocks", async () => {
      const mockResult: ReadResourceResult = {
        contents: [
          { uri: "file:///doc1.md", text: "Content 1" },
          { uri: "file:///doc2.md", text: "Content 2" },
        ],
      };
      const mockClient = createMockClientSession({ readResult: mockResult });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.readResource(
        "mcp://server1/file:///doc1.md",
        "session-123",
      );

      expect(result.contents[0]!.uri).toBe("mcp://server1/file:///doc1.md");
      expect(result.contents[1]!.uri).toBe("mcp://server1/file:///doc2.md");
    });

    it("should log debug message on successful read", async () => {
      const mockResult: ReadResourceResult = {
        contents: [{ uri: "file:///doc.md", text: "content" }],
      };
      const mockClient = createMockClientSession({ readResult: mockResult });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await service.readResource(
        "mcp://server1/file:///my-doc.md",
        "session-123",
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Read resource 'file:///my-doc.md' from server 'server1'",
      );
    });

    it("should re-throw and log error when readResource fails", async () => {
      const mockClient = createMockClientSession({});
      mockClient.readResource.mockRejectedValue(
        new Error("Resource not found"),
      );

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await expect(
        service.readResource("mcp://server1/file:///missing.md", "session-123"),
      ).rejects.toThrow("Resource not found");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to read resource 'file:///missing.md' from server 'server1':",
        expect.any(Error),
      );
    });

    it("should handle URIs with complex paths", async () => {
      const mockResult: ReadResourceResult = {
        contents: [
          { uri: "file:///path/to/nested/file.txt", text: "nested content" },
        ],
      };
      const mockClient = createMockClientSession({ readResult: mockResult });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await service.readResource(
        "mcp://server1/file:///path/to/nested/file.txt",
        "session-123",
      );

      expect(mockClient.readResource).toHaveBeenCalledWith({
        uri: "file:///path/to/nested/file.txt",
      });
    });

    it("should preserve other fields in read result", async () => {
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

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.readResource(
        "mcp://server1/file:///doc.md",
        "session-123",
      );

      expect(result.contents[0]!.mimeType).toBe("text/markdown");
      expect((result.contents[0] as { text: string }).text).toBe("# Hello");
    });

    it("should throw error for empty server name in URI", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await expect(
        service.readResource("mcp:///file:///doc.md", "session-123"),
      ).rejects.toThrow("Invalid resource URI format");
    });

    it("should throw error for empty resource URI part", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await expect(
        service.readResource("mcp://server1/", "session-123"),
      ).rejects.toThrow("Invalid resource URI format");
    });
  });

  describe("handleResourceListChanged", () => {
    it("should invalidate cache for the session", async () => {
      const serverResources: Resource[] = [
        { uri: "cached.txt", name: "Cached" },
      ];
      const mockClient = createMockClientSession({
        resources: serverResources,
      });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      // Populate cache
      await service.listResources("session-123");
      expect(mockClient.listResources).toHaveBeenCalledTimes(1);

      // Invalidate cache
      service.handleResourceListChanged("server1", "session-123");

      // Should fetch again after invalidation
      await service.listResources("session-123");
      expect(mockClient.listResources).toHaveBeenCalledTimes(2);
    });

    it("should log cache invalidation", () => {
      service.handleResourceListChanged("server1", "session-123");

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Resource list changed for server 'server1' in session 'session-123'",
      );
    });

    it("should not affect other session caches", async () => {
      const serverResources: Resource[] = [{ uri: "r1", name: "R1" }];
      const mockClient = createMockClientSession({
        resources: serverResources,
      });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      // Populate cache for two sessions
      await service.listResources("session-A");
      await service.listResources("session-B");

      // Invalidate only session-A
      service.handleResourceListChanged("server1", "session-A");

      // Fetch again - session-B should still be cached
      await service.listResources("session-B");

      // Total calls: 2 during initial population (one per session)
      // After invalidation: session-B returns cached, no new call
      expect(mockClient.listResources).toHaveBeenCalledTimes(2);
    });
  });
});

// Helper function to create mock client sessions
function createMockClientSession(options: {
  resources?: Resource[];
  readResult?: ReadResourceResult;
}): {
  listResources: ReturnType<typeof vi.fn>;
  readResource: ReturnType<typeof vi.fn>;
} {
  return {
    listResources: vi.fn().mockResolvedValue(options.resources ?? []),
    readResource: vi
      .fn()
      .mockResolvedValue(options.readResult ?? { contents: [] }),
  };
}
