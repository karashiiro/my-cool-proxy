import { describe, it, expect, vi, beforeEach } from "vitest";
import { MCPClientSession } from "./client-session.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ILogger } from "./types.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

// Mock logger
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
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
      listPrompts: vi.fn(),
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
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      const result = await session.listTools();

      expect(result).toEqual(mockResponse.tools);
      expect(result).toHaveLength(2);
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
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const session = new MCPClientSession(mockClient, serverName, [], logger);

      const result = await session.listTools();

      expect(result).toEqual([]);
      expect(logger.info).toHaveBeenCalledWith(
        `Server '${serverName}': All tools blocked by empty allowedTools array`,
      );
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
        ],
      };

      vi.mocked(mockClient.listTools).mockResolvedValue(mockResponse);

      const allowedTools = ["read-file"];
      const session = new MCPClientSession(
        mockClient,
        serverName,
        allowedTools,
        logger,
      );

      const result = await session.listTools();

      expect(result.map((t) => t.name)).toEqual(["read-file"]);
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
      expect(result1).toEqual(mockResponse.tools);
      expect(mockClient.listTools).toHaveBeenCalledTimes(1);

      // Second call should return cached result
      const result2 = await session.listTools();
      expect(result2).toEqual(mockResponse.tools);
      expect(mockClient.listTools).toHaveBeenCalledTimes(1); // Still only 1 call

      // Should log cache hit
      expect(logger.debug).toHaveBeenCalledWith(
        `Server '${serverName}': Returning cached tool list`,
      );
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
      expect(result1).toHaveLength(1);
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
      expect(result3).toHaveLength(2);
      expect(mockClient.listTools).toHaveBeenCalledTimes(2);
    });
  });

  describe("resource list caching", () => {
    it("should list resources when no pagination", async () => {
      const mockResponse = {
        resources: [
          {
            uri: "file:///test1.txt",
            name: "Test File 1",
            mimeType: "text/plain",
          },
          {
            uri: "file:///test2.txt",
            name: "Test File 2",
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

      expect(result).toHaveLength(2);
      expect(result[0]?.uri).toBe("file:///test1.txt");
      expect(mockClient.listResources).toHaveBeenCalledTimes(1);
    });

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
      await session.listResources();
      expect(mockClient.listResources).toHaveBeenCalledTimes(1);

      // Second call should return cached result
      await session.listResources();
      expect(mockClient.listResources).toHaveBeenCalledTimes(1); // Still only 1 call

      expect(logger.debug).toHaveBeenCalledWith(
        `Server '${serverName}': Returning cached resource list`,
      );
    });
  });

  describe("prompt list caching", () => {
    it("should list prompts when no pagination", async () => {
      const mockResponse = {
        prompts: [
          {
            name: "code-review",
            description: "Review code for best practices",
          },
          {
            name: "summarize",
            description: "Create a summary of text",
          },
        ],
      };

      vi.mocked(mockClient.listPrompts).mockResolvedValue(mockResponse);

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      const result = await session.listPrompts();

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe("code-review");
      expect(mockClient.listPrompts).toHaveBeenCalledTimes(1);
    });

    it("should cache prompt list after first call", async () => {
      const mockResponse = {
        prompts: [
          {
            name: "cached-prompt",
            description: "Cached prompt",
          },
        ],
      };

      vi.mocked(mockClient.listPrompts).mockResolvedValue(mockResponse);

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      // First call should fetch from client
      await session.listPrompts();
      expect(mockClient.listPrompts).toHaveBeenCalledTimes(1);

      // Second call should return cached result
      await session.listPrompts();
      expect(mockClient.listPrompts).toHaveBeenCalledTimes(1); // Still only 1 call

      expect(logger.debug).toHaveBeenCalledWith(
        `Server '${serverName}': Returning cached prompt list`,
      );
    });
  });

  describe("experimental getter", () => {
    it("should passthrough to client.experimental", () => {
      const mockExperimental = {
        feature1: true,
        feature2: "value",
      };

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
  });

  describe("getServerName", () => {
    it("should return the server name", () => {
      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      expect(session.getServerName()).toBe(serverName);
    });
  });
});
