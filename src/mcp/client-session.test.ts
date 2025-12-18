import { describe, it, expect, vi, beforeEach } from "vitest";
import { MCPClientSession } from "./client-session.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ILogger } from "../types/interfaces.js";
import {
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Mock logger
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

describe("MCPClientSession", () => {
  let logger: ILogger;
  let mockClient: Client;
  const serverName = "test-server";

  beforeEach(() => {
    logger = createMockLogger();
    mockClient = {
      listTools: vi.fn(),
      listResources: vi.fn(),
      close: vi.fn(),
      setNotificationHandler: vi.fn(),
      experimental: { someProperty: "test-value" },
    } as unknown as Client;
  });

  describe("listTools - no filter", () => {
    it("should return all tools when allowedTools is undefined", async () => {
      const mockResponse = {
        tools: [
          {
            name: "tool1",
            description: "First tool",
            inputSchema: { type: "object" as const },
          },
          {
            name: "tool2",
            description: "Second tool",
            inputSchema: { type: "object" as const },
          },
          {
            name: "tool3",
            description: "Third tool",
            inputSchema: { type: "object" as const },
          },
        ],
        _meta: { someMetadata: "value" },
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      const result = await session.listTools();

      // Should return response unchanged
      expect(result).toEqual(mockResponse);
      expect(result.tools).toHaveLength(3);

      // Should not log anything when no filter is applied
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should preserve response metadata when no filter", async () => {
      const mockResponse = {
        tools: [
          {
            name: "tool1",
            description: "Tool",
            inputSchema: { type: "object" as const },
          },
        ],
        nextCursor: "cursor123",
        _meta: { version: "1.0" },
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      const result = await session.listTools();

      expect(result).toEqual(mockResponse);
      expect(result.nextCursor).toBe("cursor123");
      expect(result._meta).toEqual({ version: "1.0" });
    });
  });

  describe("listTools - empty filter", () => {
    it("should return no tools when allowedTools is empty array", async () => {
      const mockResponse = {
        tools: [
          {
            name: "tool1",
            description: "First tool",
            inputSchema: { type: "object" as const },
          },
          {
            name: "tool2",
            description: "Second tool",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const session = new MCPClientSession(mockClient, serverName, [], logger);

      const result = await session.listTools();

      // Should return empty tools array
      expect(result.tools).toHaveLength(0);
      expect(result.tools).toEqual([]);

      // Should log that all tools are blocked
      expect(logger.info).toHaveBeenCalledWith(
        `Server '${serverName}': All tools blocked by empty allowedTools array`,
      );
    });

    it("should preserve other response properties with empty filter", async () => {
      const mockResponse = {
        tools: [
          {
            name: "tool1",
            description: "Tool",
            inputSchema: { type: "object" as const },
          },
        ],
        nextCursor: "cursor456",
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const session = new MCPClientSession(mockClient, serverName, [], logger);

      const result = await session.listTools();

      expect(result.tools).toEqual([]);
      expect(result.nextCursor).toBe("cursor456");
    });
  });

  describe("listTools - with filter", () => {
    it("should filter to only allowed tools", async () => {
      const mockResponse = {
        tools: [
          {
            name: "read-file",
            description: "Read files",
            inputSchema: { type: "object" as const },
          },
          {
            name: "write-file",
            description: "Write files",
            inputSchema: { type: "object" as const },
          },
          {
            name: "delete-file",
            description: "Delete files",
            inputSchema: { type: "object" as const },
          },
          {
            name: "list-files",
            description: "List files",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const allowedTools = ["read-file", "list-files"];
      const session = new MCPClientSession(
        mockClient,
        serverName,
        allowedTools,
        logger,
      );

      const result = await session.listTools();

      // Should only include allowed tools
      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.name)).toEqual([
        "read-file",
        "list-files",
      ]);

      // Should log filtering info
      expect(logger.info).toHaveBeenCalledWith(
        `Server '${serverName}': Filtered to 2 of 4 tools: read-file, list-files`,
      );

      // Should not log errors since all allowed tools exist
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should handle single allowed tool", async () => {
      const mockResponse = {
        tools: [
          {
            name: "tool1",
            description: "Tool 1",
            inputSchema: { type: "object" as const },
          },
          {
            name: "tool2",
            description: "Tool 2",
            inputSchema: { type: "object" as const },
          },
          {
            name: "tool3",
            description: "Tool 3",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const session = new MCPClientSession(
        mockClient,
        serverName,
        ["tool2"],
        logger,
      );

      const result = await session.listTools();

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]?.name).toBe("tool2");

      expect(logger.info).toHaveBeenCalledWith(
        `Server '${serverName}': Filtered to 1 of 3 tools: tool2`,
      );
    });

    it("should preserve tool properties when filtering", async () => {
      const mockResponse = {
        tools: [
          {
            name: "complex-tool",
            description: "A complex tool",
            inputSchema: {
              type: "object" as const,
              properties: { arg: { type: "string" } },
            },
          },
          {
            name: "other-tool",
            description: "Other",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const session = new MCPClientSession(
        mockClient,
        serverName,
        ["complex-tool"],
        logger,
      );

      const result = await session.listTools();

      expect(result.tools[0]?.name).toBe("complex-tool");
      expect(result.tools[0]?.description).toBe("A complex tool");
      expect(result.tools[0]?.inputSchema).toEqual({
        type: "object",
        properties: { arg: { type: "string" } },
      });
    });

    it("should filter all tools if none match allowedTools", async () => {
      const mockResponse = {
        tools: [
          {
            name: "tool1",
            description: "Tool 1",
            inputSchema: { type: "object" as const },
          },
          {
            name: "tool2",
            description: "Tool 2",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const session = new MCPClientSession(
        mockClient,
        serverName,
        ["nonexistent"],
        logger,
      );

      const result = await session.listTools();

      // Should return no tools
      expect(result.tools).toHaveLength(0);

      // Should log error for nonexistent tool
      expect(logger.error).toHaveBeenCalledWith(
        `Server '${serverName}': Tool 'nonexistent' in allowedTools not found. Available: tool1, tool2`,
      );

      // Should still log filtering info
      expect(logger.info).toHaveBeenCalledWith(
        `Server '${serverName}': Filtered to 0 of 2 tools: `,
      );
    });
  });

  describe("listTools - error handling", () => {
    it("should log error for each nonexistent tool in allowedTools", async () => {
      const mockResponse = {
        tools: [
          {
            name: "existing1",
            description: "Exists 1",
            inputSchema: { type: "object" as const },
          },
          {
            name: "existing2",
            description: "Exists 2",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const allowedTools = [
        "existing1",
        "missing1",
        "missing2",
        "existing2",
        "missing3",
      ];
      const session = new MCPClientSession(
        mockClient,
        serverName,
        allowedTools,
        logger,
      );

      await session.listTools();

      // Should log error for each missing tool
      expect(logger.error).toHaveBeenCalledWith(
        `Server '${serverName}': Tool 'missing1' in allowedTools not found. Available: existing1, existing2`,
      );
      expect(logger.error).toHaveBeenCalledWith(
        `Server '${serverName}': Tool 'missing2' in allowedTools not found. Available: existing1, existing2`,
      );
      expect(logger.error).toHaveBeenCalledWith(
        `Server '${serverName}': Tool 'missing3' in allowedTools not found. Available: existing1, existing2`,
      );

      // Should be called 3 times total (one per missing tool)
      expect(logger.error).toHaveBeenCalledTimes(3);
    });

    it("should still filter correctly even when some tools don't exist", async () => {
      const mockResponse = {
        tools: [
          {
            name: "tool-a",
            description: "Tool A",
            inputSchema: { type: "object" as const },
          },
          {
            name: "tool-b",
            description: "Tool B",
            inputSchema: { type: "object" as const },
          },
          {
            name: "tool-c",
            description: "Tool C",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const allowedTools = ["tool-a", "nonexistent", "tool-c"];
      const session = new MCPClientSession(
        mockClient,
        serverName,
        allowedTools,
        logger,
      );

      const result = await session.listTools();

      // Should include only the existing allowed tools
      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.name)).toEqual(["tool-a", "tool-c"]);

      // Should log error for missing tool
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("'nonexistent' in allowedTools not found"),
      );

      // Should log correct filtering count
      expect(logger.info).toHaveBeenCalledWith(
        `Server '${serverName}': Filtered to 2 of 3 tools: tool-a, tool-c`,
      );
    });

    it("should handle empty tools array from server", async () => {
      const mockResponse = {
        tools: [],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const allowedTools = ["some-tool"];
      const session = new MCPClientSession(
        mockClient,
        serverName,
        allowedTools,
        logger,
      );

      const result = await session.listTools();

      expect(result.tools).toEqual([]);

      // Should log error since requested tool doesn't exist
      expect(logger.error).toHaveBeenCalledWith(
        `Server '${serverName}': Tool 'some-tool' in allowedTools not found. Available: `,
      );
    });
  });

  describe("listTools - case sensitivity", () => {
    it("should be case sensitive when filtering", async () => {
      const mockResponse = {
        tools: [
          {
            name: "ReadFile",
            description: "Read files",
            inputSchema: { type: "object" as const },
          },
          {
            name: "readfile",
            description: "Read files",
            inputSchema: { type: "object" as const },
          },
          {
            name: "READFILE",
            description: "Read files",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const allowedTools = ["ReadFile", "READFILE"];
      const session = new MCPClientSession(
        mockClient,
        serverName,
        allowedTools,
        logger,
      );

      const result = await session.listTools();

      // Should only match exact case
      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.name)).toEqual(["ReadFile", "READFILE"]);
    });
  });

  describe("experimental getter", () => {
    it("should passthrough to client.experimental", () => {
      const mockExperimental = {
        feature1: true,
        feature2: "value",
      };

      // Use Object.defineProperty to set the experimental property
      Object.defineProperty(mockClient, "experimental", {
        value: mockExperimental,
        writable: true,
        configurable: true,
      });

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      expect(session.experimental).toBe(mockExperimental);
      expect(session.experimental).toEqual({
        feature1: true,
        feature2: "value",
      });
    });

    it("should reflect changes to client.experimental", () => {
      // Use Object.defineProperty to set initial value
      Object.defineProperty(mockClient, "experimental", {
        value: { initial: "value" },
        writable: true,
        configurable: true,
      });

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      expect(session.experimental).toEqual({ initial: "value" });

      // Update client experimental using Object.defineProperty
      Object.defineProperty(mockClient, "experimental", {
        value: { updated: "new-value" },
        writable: true,
        configurable: true,
      });

      expect(session.experimental).toEqual({ updated: "new-value" });
    });
  });

  describe("close", () => {
    it("should call client.close", async () => {
      vi.mocked(mockClient.close).mockResolvedValue(undefined);

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      await session.close();

      expect(mockClient.close).toHaveBeenCalledTimes(1);
    });

    it("should return the result from client.close", async () => {
      const closeResult = { status: "closed" };
      vi.mocked(mockClient.close).mockResolvedValue(
        closeResult as unknown as void,
      );

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      const result = await session.close();

      expect(result).toBe(closeResult);
    });

    it("should propagate errors from client.close", async () => {
      const error = new Error("Close failed");
      vi.mocked(mockClient.close).mockRejectedValue(error);

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      await expect(session.close()).rejects.toThrow("Close failed");
    });
  });

  describe("tool list caching", () => {
    it("should cache tool list after first call", async () => {
      const mockResponse = {
        tools: [
          {
            name: "tool1",
            description: "Tool 1",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      // First call should fetch from client
      const result1 = await session.listTools();
      expect(result1).toEqual(mockResponse);
      expect(mockClient.listTools).toHaveBeenCalledTimes(1);

      // Second call should return cached result
      const result2 = await session.listTools();
      expect(result2).toEqual(mockResponse);
      expect(mockClient.listTools).toHaveBeenCalledTimes(1); // Still only 1 call

      // Should log cache hit
      expect(logger.debug).toHaveBeenCalledWith(
        `Server '${serverName}': Returning cached tool list`,
      );
    });

    it("should cache filtered tool list", async () => {
      const mockResponse = {
        tools: [
          {
            name: "tool1",
            description: "Tool 1",
            inputSchema: { type: "object" as const },
          },
          {
            name: "tool2",
            description: "Tool 2",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const session = new MCPClientSession(
        mockClient,
        serverName,
        ["tool1"],
        logger,
      );

      // First call should fetch and filter
      const result1 = await session.listTools();
      expect(result1.tools).toHaveLength(1);
      expect(result1.tools[0]?.name).toBe("tool1");
      expect(mockClient.listTools).toHaveBeenCalledTimes(1);

      // Second call should return cached filtered result
      const result2 = await session.listTools();
      expect(result2.tools).toHaveLength(1);
      expect(result2.tools[0]?.name).toBe("tool1");
      expect(mockClient.listTools).toHaveBeenCalledTimes(1); // Still only 1 call
    });
  });

  describe("cache invalidation", () => {
    it("should invalidate cache when tool list changed notification is received", async () => {
      const mockResponse1 = {
        tools: [
          {
            name: "tool1",
            description: "Tool 1",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      const mockResponse2 = {
        tools: [
          {
            name: "tool1",
            description: "Tool 1",
            inputSchema: { type: "object" as const },
          },
          {
            name: "tool2",
            description: "Tool 2",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools)
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      // Mock setNotificationHandler to capture the handler
      let notificationHandler: (() => Promise<void>) | undefined;
      vi.mocked(mockClient.setNotificationHandler).mockImplementation(
        (schema, handler) => {
          if (schema === ToolListChangedNotificationSchema) {
            notificationHandler = handler as () => Promise<void>;
          }
        },
      );

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      // First call should fetch
      const result1 = await session.listTools();
      expect(result1.tools).toHaveLength(1);
      expect(mockClient.listTools).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result2 = await session.listTools();
      expect(result2.tools).toHaveLength(1);
      expect(mockClient.listTools).toHaveBeenCalledTimes(1);

      // Trigger notification
      expect(notificationHandler).toBeDefined();
      await notificationHandler!();

      // Should log cache invalidation
      expect(logger.info).toHaveBeenCalledWith(
        `Server '${serverName}': Tool list changed, invalidating cache`,
      );

      // Next call should fetch fresh data
      const result3 = await session.listTools();
      expect(result3.tools).toHaveLength(2);
      expect(mockClient.listTools).toHaveBeenCalledTimes(2);
    });

    it("should handle multiple cache invalidations", async () => {
      const mockResponse = {
        tools: [
          {
            name: "tool1",
            description: "Tool 1",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      // Mock setNotificationHandler to capture the handler
      let notificationHandler: (() => Promise<void>) | undefined;
      vi.mocked(mockClient.setNotificationHandler).mockImplementation(
        (schema, handler) => {
          if (schema === ToolListChangedNotificationSchema) {
            notificationHandler = handler as () => Promise<void>;
          }
        },
      );

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      // Fetch and cache
      await session.listTools();
      expect(mockClient.listTools).toHaveBeenCalledTimes(1);

      // Invalidate multiple times
      await notificationHandler!();
      await notificationHandler!();
      await notificationHandler!();

      // Next call should still fetch fresh
      await session.listTools();
      expect(mockClient.listTools).toHaveBeenCalledTimes(2);
    });
  });

  describe("integration scenarios", () => {
    it("should handle multiple listTools calls with same session", async () => {
      const mockResponse = {
        tools: [
          {
            name: "tool1",
            description: "Tool 1",
            inputSchema: { type: "object" as const },
          },
          {
            name: "tool2",
            description: "Tool 2",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const allowedTools = ["tool1", "tool2"];
      const session = new MCPClientSession(
        mockClient,
        serverName,
        allowedTools,
        logger,
      );

      const result1 = await session.listTools();
      expect(result1.tools).toHaveLength(2);

      const result2 = await session.listTools();
      expect(result2.tools).toHaveLength(2);
      expect(result2.tools.map((t) => t.name)).toEqual(["tool1", "tool2"]);

      // Should only call once due to caching
      expect(mockClient.listTools).toHaveBeenCalledTimes(1);
    });

    it("should work correctly with different server names", async () => {
      const mockResponse = {
        tools: [
          {
            name: "tool1",
            description: "Tool",
            inputSchema: { type: "object" as const },
          },
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const session1 = new MCPClientSession(
        mockClient,
        "server-one",
        ["nonexistent"],
        logger,
      );

      await session1.listTools();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Server 'server-one':"),
      );

      vi.clearAllMocks();

      const session2 = new MCPClientSession(
        mockClient,
        "server-two",
        ["nonexistent"],
        logger,
      );

      await session2.listTools();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Server 'server-two':"),
      );
    });
  });

  describe("resource list caching", () => {
    describe("basic resource listing", () => {
      it("should list resources when no pagination", async () => {
        const mockResponse = {
          resources: [
            {
              uri: "file:///test1.txt",
              name: "Test File 1",
              description: "First test file",
              mimeType: "text/plain",
            },
            {
              uri: "file:///test2.txt",
              name: "Test File 2",
              description: "Second test file",
              mimeType: "text/plain",
            },
          ],
        };

        vi.mocked(mockClient.listResources).mockResolvedValue(mockResponse);

        const session = new MCPClientSession(
          mockClient,
          serverName,
          undefined,
          logger,
        );

        const result = await session.listResources();

        expect(result.resources).toHaveLength(2);
        expect(result.resources[0]?.uri).toBe("file:///test1.txt");
        expect(result.resources[1]?.uri).toBe("file:///test2.txt");
        expect(mockClient.listResources).toHaveBeenCalledTimes(1);
        expect(mockClient.listResources).toHaveBeenCalledWith(undefined);
        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
      });

      it("should preserve resource metadata", async () => {
        const mockResponse = {
          resources: [
            {
              uri: "file:///data.json",
              name: "Data",
              mimeType: "application/json",
            },
          ],
          _meta: { version: "2.0", timestamp: "2024-01-01" },
        };

        vi.mocked(mockClient.listResources).mockResolvedValue(mockResponse);

        const session = new MCPClientSession(
          mockClient,
          serverName,
          undefined,
          logger,
        );

        const result = await session.listResources();

        expect(result._meta).toEqual({
          version: "2.0",
          timestamp: "2024-01-01",
        });
        expect(result.resources).toHaveLength(1);
      });

      it("should handle empty resource list", async () => {
        const mockResponse = {
          resources: [],
        };

        vi.mocked(mockClient.listResources).mockResolvedValue(mockResponse);

        const session = new MCPClientSession(
          mockClient,
          serverName,
          undefined,
          logger,
        );

        const result = await session.listResources();

        expect(result.resources).toEqual([]);
        expect(mockClient.listResources).toHaveBeenCalledTimes(1);
        expect(logger.error).not.toHaveBeenCalled();
      });
    });

    describe("pagination handling", () => {
      it("should fetch single page when no cursor", async () => {
        const mockResponse = {
          resources: [
            {
              uri: "file:///page1.txt",
              name: "Page 1",
              mimeType: "text/plain",
            },
          ],
        };

        vi.mocked(mockClient.listResources).mockResolvedValue(mockResponse);

        const session = new MCPClientSession(
          mockClient,
          serverName,
          undefined,
          logger,
        );

        const result = await session.listResources();

        expect(mockClient.listResources).toHaveBeenCalledTimes(1);
        expect(mockClient.listResources).toHaveBeenCalledWith(undefined);
        expect(result.resources).toHaveLength(1);
        expect(result.nextCursor).toBeUndefined();
      });

      it("should fetch all pages when pagination present", async () => {
        const mockResponse1 = {
          resources: [
            {
              uri: "file:///page1-item1.txt",
              name: "Page 1 Item 1",
              mimeType: "text/plain",
            },
            {
              uri: "file:///page1-item2.txt",
              name: "Page 1 Item 2",
              mimeType: "text/plain",
            },
          ],
          nextCursor: "cursor1",
        };

        const mockResponse2 = {
          resources: [
            {
              uri: "file:///page2-item1.txt",
              name: "Page 2 Item 1",
              mimeType: "text/plain",
            },
            {
              uri: "file:///page2-item2.txt",
              name: "Page 2 Item 2",
              mimeType: "text/plain",
            },
            {
              uri: "file:///page2-item3.txt",
              name: "Page 2 Item 3",
              mimeType: "text/plain",
            },
          ],
          nextCursor: "cursor2",
        };

        const mockResponse3 = {
          resources: [
            {
              uri: "file:///page3-item1.txt",
              name: "Page 3 Item 1",
              mimeType: "text/plain",
            },
          ],
          _meta: { finalPage: true },
        };

        vi.mocked(mockClient.listResources)
          .mockResolvedValueOnce(mockResponse1)
          .mockResolvedValueOnce(mockResponse2)
          .mockResolvedValueOnce(mockResponse3);

        const session = new MCPClientSession(
          mockClient,
          serverName,
          undefined,
          logger,
        );

        const result = await session.listResources();

        // Verify all three calls were made with correct parameters
        expect(mockClient.listResources).toHaveBeenCalledTimes(3);
        expect(mockClient.listResources).toHaveBeenNthCalledWith(1, undefined);
        expect(mockClient.listResources).toHaveBeenNthCalledWith(2, {
          cursor: "cursor1",
        });
        expect(mockClient.listResources).toHaveBeenNthCalledWith(3, {
          cursor: "cursor2",
        });

        // Verify all resources are combined
        expect(result.resources).toHaveLength(6);
        expect(result.resources[0]?.uri).toBe("file:///page1-item1.txt");
        expect(result.resources[2]?.uri).toBe("file:///page2-item1.txt");
        expect(result.resources[5]?.uri).toBe("file:///page3-item1.txt");

        // Verify no nextCursor in final result
        expect(result.nextCursor).toBeUndefined();

        // Verify metadata from last response is preserved
        expect(result._meta).toEqual({ finalPage: true });
      });

      it("should handle many pages of resources", async () => {
        // Create 10 pages of resources
        const mockResponses = Array.from({ length: 10 }, (_, i) => ({
          resources: [
            {
              uri: `file:///page${i + 1}.txt`,
              name: `Page ${i + 1}`,
              mimeType: "text/plain",
            },
          ],
          nextCursor: i < 9 ? `cursor${i + 1}` : undefined,
        }));

        const mockFn = vi.mocked(mockClient.listResources);
        mockResponses.forEach((response) => {
          mockFn.mockResolvedValueOnce(response);
        });

        const session = new MCPClientSession(
          mockClient,
          serverName,
          undefined,
          logger,
        );

        const result = await session.listResources();

        expect(mockClient.listResources).toHaveBeenCalledTimes(10);
        expect(result.resources).toHaveLength(10);
        expect(result.resources[0]?.uri).toBe("file:///page1.txt");
        expect(result.resources[9]?.uri).toBe("file:///page10.txt");
      });
    });

    describe("caching behavior", () => {
      it("should cache resource list after first call", async () => {
        const mockResponse = {
          resources: [
            {
              uri: "file:///cached.txt",
              name: "Cached File",
              mimeType: "text/plain",
            },
          ],
        };

        vi.mocked(mockClient.listResources).mockResolvedValue(mockResponse);

        const session = new MCPClientSession(
          mockClient,
          serverName,
          undefined,
          logger,
        );

        // First call should fetch from client
        const result1 = await session.listResources();
        expect(result1.resources).toHaveLength(1);
        expect(mockClient.listResources).toHaveBeenCalledTimes(1);

        // Second call should return cached result
        const result2 = await session.listResources();
        expect(result2.resources).toHaveLength(1);
        expect(mockClient.listResources).toHaveBeenCalledTimes(1); // Still only 1 call

        // Should log cache hit
        expect(logger.debug).toHaveBeenCalledWith(
          `Server '${serverName}': Returning cached resource list`,
        );
      });

      it("should cache complete paginated results", async () => {
        const mockResponse1 = {
          resources: [
            {
              uri: "file:///page1.txt",
              name: "Page 1",
              mimeType: "text/plain",
            },
          ],
          nextCursor: "cursor1",
        };

        const mockResponse2 = {
          resources: [
            {
              uri: "file:///page2.txt",
              name: "Page 2",
              mimeType: "text/plain",
            },
          ],
        };

        vi.mocked(mockClient.listResources)
          .mockResolvedValueOnce(mockResponse1)
          .mockResolvedValueOnce(mockResponse2);

        const session = new MCPClientSession(
          mockClient,
          serverName,
          undefined,
          logger,
        );

        // First call fetches both pages
        const result1 = await session.listResources();
        expect(result1.resources).toHaveLength(2);
        expect(mockClient.listResources).toHaveBeenCalledTimes(2);

        // Second call returns cached result with both pages
        const result2 = await session.listResources();
        expect(result2.resources).toHaveLength(2);
        expect(mockClient.listResources).toHaveBeenCalledTimes(2); // No additional calls
      });

      it("should not refetch on multiple cache hits", async () => {
        const mockResponse = {
          resources: [
            {
              uri: "file:///test.txt",
              name: "Test",
              mimeType: "text/plain",
            },
          ],
        };

        vi.mocked(mockClient.listResources).mockResolvedValue(mockResponse);

        const session = new MCPClientSession(
          mockClient,
          serverName,
          undefined,
          logger,
        );

        // First call fetches
        await session.listResources();
        expect(mockClient.listResources).toHaveBeenCalledTimes(1);

        // Multiple subsequent calls use cache
        await session.listResources();
        await session.listResources();
        await session.listResources();
        await session.listResources();

        expect(mockClient.listResources).toHaveBeenCalledTimes(1); // Still only 1 call
        expect(logger.debug).toHaveBeenCalledTimes(4); // 4 cache hits
      });
    });

    describe("cache invalidation", () => {
      it("should invalidate cache when resource list changed notification received", async () => {
        const mockResponse1 = {
          resources: [
            {
              uri: "file:///original.txt",
              name: "Original",
              mimeType: "text/plain",
            },
          ],
        };

        const mockResponse2 = {
          resources: [
            {
              uri: "file:///updated1.txt",
              name: "Updated 1",
              mimeType: "text/plain",
            },
            {
              uri: "file:///updated2.txt",
              name: "Updated 2",
              mimeType: "text/plain",
            },
            {
              uri: "file:///updated3.txt",
              name: "Updated 3",
              mimeType: "text/plain",
            },
          ],
        };

        vi.mocked(mockClient.listResources)
          .mockResolvedValueOnce(mockResponse1)
          .mockResolvedValueOnce(mockResponse2);

        // Capture notification handler
        let resourceNotificationHandler: (() => Promise<void>) | undefined;
        vi.mocked(mockClient.setNotificationHandler).mockImplementation(
          (schema, handler) => {
            if (schema === ResourceListChangedNotificationSchema) {
              resourceNotificationHandler = handler as () => Promise<void>;
            }
          },
        );

        const session = new MCPClientSession(
          mockClient,
          serverName,
          undefined,
          logger,
        );

        // First call should fetch
        const result1 = await session.listResources();
        expect(result1.resources).toHaveLength(1);
        expect(mockClient.listResources).toHaveBeenCalledTimes(1);

        // Second call should use cache
        const result2 = await session.listResources();
        expect(result2.resources).toHaveLength(1);
        expect(mockClient.listResources).toHaveBeenCalledTimes(1);

        // Trigger notification
        expect(resourceNotificationHandler).toBeDefined();
        await resourceNotificationHandler!();

        // Should log cache invalidation
        expect(logger.info).toHaveBeenCalledWith(
          `Server '${serverName}': Resource list changed, invalidating cache`,
        );

        // Next call should fetch fresh data
        const result3 = await session.listResources();
        expect(result3.resources).toHaveLength(3);
        expect(mockClient.listResources).toHaveBeenCalledTimes(2);
      });

      it("should handle multiple cache invalidations", async () => {
        const mockResponse = {
          resources: [
            {
              uri: "file:///test.txt",
              name: "Test",
              mimeType: "text/plain",
            },
          ],
        };

        vi.mocked(mockClient.listResources).mockResolvedValue(mockResponse);

        // Capture notification handler
        let resourceNotificationHandler: (() => Promise<void>) | undefined;
        vi.mocked(mockClient.setNotificationHandler).mockImplementation(
          (schema, handler) => {
            if (schema === ResourceListChangedNotificationSchema) {
              resourceNotificationHandler = handler as () => Promise<void>;
            }
          },
        );

        const session = new MCPClientSession(
          mockClient,
          serverName,
          undefined,
          logger,
        );

        // Fetch and cache
        await session.listResources();
        expect(mockClient.listResources).toHaveBeenCalledTimes(1);

        // Invalidate multiple times
        await resourceNotificationHandler!();
        await resourceNotificationHandler!();
        await resourceNotificationHandler!();

        expect(logger.info).toHaveBeenCalledTimes(3);

        // Next call should still fetch fresh
        await session.listResources();
        expect(mockClient.listResources).toHaveBeenCalledTimes(2);
      });
    });

    describe("integration scenarios", () => {
      it("should handle multiple listResources calls in sequence", async () => {
        const mockResponse = {
          resources: [
            {
              uri: "file:///resource1.txt",
              name: "Resource 1",
              mimeType: "text/plain",
            },
            {
              uri: "file:///resource2.txt",
              name: "Resource 2",
              mimeType: "text/plain",
            },
          ],
        };

        vi.mocked(mockClient.listResources).mockResolvedValue(mockResponse);

        const session = new MCPClientSession(
          mockClient,
          serverName,
          undefined,
          logger,
        );

        const result1 = await session.listResources();
        expect(result1.resources).toHaveLength(2);

        const result2 = await session.listResources();
        expect(result2.resources).toHaveLength(2);

        const result3 = await session.listResources();
        expect(result3.resources).toHaveLength(2);

        // Should only call once due to caching
        expect(mockClient.listResources).toHaveBeenCalledTimes(1);

        // Results should be consistent
        expect(result1.resources[0]?.uri).toBe(result2.resources[0]?.uri);
        expect(result2.resources[0]?.uri).toBe(result3.resources[0]?.uri);
      });

      it("should work correctly with different server names", async () => {
        const mockResponse = {
          resources: [
            {
              uri: "file:///test.txt",
              name: "Test",
              mimeType: "text/plain",
            },
          ],
        };

        vi.mocked(mockClient.listResources).mockResolvedValue(mockResponse);

        // Capture notification handler
        let resourceNotificationHandler: (() => Promise<void>) | undefined;
        vi.mocked(mockClient.setNotificationHandler).mockImplementation(
          (schema, handler) => {
            if (schema === ResourceListChangedNotificationSchema) {
              resourceNotificationHandler = handler as () => Promise<void>;
            }
          },
        );

        const session1 = new MCPClientSession(
          mockClient,
          "server-one",
          undefined,
          logger,
        );

        await session1.listResources();
        await resourceNotificationHandler!();

        expect(logger.info).toHaveBeenCalledWith(
          expect.stringContaining("Server 'server-one':"),
        );

        vi.clearAllMocks();

        const session2 = new MCPClientSession(
          mockClient,
          "server-two",
          undefined,
          logger,
        );

        await session2.listResources();
        await resourceNotificationHandler!();

        expect(logger.info).toHaveBeenCalledWith(
          expect.stringContaining("Server 'server-two':"),
        );
      });
    });
  });
});
