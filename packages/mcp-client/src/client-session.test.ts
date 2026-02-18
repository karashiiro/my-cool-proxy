import { describe, it, expect, vi, beforeEach } from "vitest";
import { MCPClientSession } from "./client-session.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ILogger } from "./types.js";
import {
  ToolListChangedNotificationSchema,
  LoggingMessageNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Mock logger
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
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

  describe("resource template list caching", () => {
    it("should list resource templates when no pagination", async () => {
      const mockResponse = {
        resourceTemplates: [
          {
            uriTemplate: "deployment://{region}/{service}",
            name: "deployment",
          },
          {
            uriTemplate: "log://{date}",
            name: "log",
          },
        ],
      };

      vi.mocked(
        mockClient as unknown as {
          listResourceTemplates: ReturnType<typeof vi.fn>;
        },
      ).listResourceTemplates = vi.fn().mockResolvedValue(mockResponse);

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      const result = await session.listResourceTemplates();

      expect(result).toHaveLength(2);
      expect(result[0]?.uriTemplate).toBe("deployment://{region}/{service}");
    });

    it("should cache resource template list after first call", async () => {
      const mockResponse = {
        resourceTemplates: [
          {
            uriTemplate: "cached://{id}",
            name: "cached",
          },
        ],
      };

      const listResourceTemplatesFn = vi.fn().mockResolvedValue(mockResponse);
      (
        mockClient as unknown as {
          listResourceTemplates: ReturnType<typeof vi.fn>;
        }
      ).listResourceTemplates = listResourceTemplatesFn;

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      // First call should fetch from client
      await session.listResourceTemplates();
      expect(listResourceTemplatesFn).toHaveBeenCalledTimes(1);

      // Second call should return cached result
      await session.listResourceTemplates();
      expect(listResourceTemplatesFn).toHaveBeenCalledTimes(1);

      expect(logger.debug).toHaveBeenCalledWith(
        `Server '${serverName}': Returning cached resource template list`,
      );
    });
  });

  describe("complete", () => {
    it("should delegate to client.complete", async () => {
      const mockResult = {
        completion: { values: ["typescript", "terraform"], hasMore: false },
      };

      const completeFn = vi.fn().mockResolvedValue(mockResult);
      (
        mockClient as unknown as { complete: ReturnType<typeof vi.fn> }
      ).complete = completeFn;

      const session = new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
      );

      const params = {
        ref: { type: "ref/prompt" as const, name: "code-review" },
        argument: { name: "language", value: "ty" },
      };

      const result = await session.complete(params);

      expect(completeFn).toHaveBeenCalledWith(params);
      expect(result.completion.values).toEqual(["typescript", "terraform"]);
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

  describe("logging message notifications", () => {
    // Variable to capture logging handler during session creation
    let loggingHandler:
      | ((notification: {
          params: { level: string; logger?: string; data: unknown };
        }) => Promise<void>)
      | undefined;

    // Set up mock to capture handler - must run before creating session
    beforeEach(() => {
      loggingHandler = undefined;
      vi.mocked(mockClient.setNotificationHandler).mockImplementation(
        (schema, handler) => {
          if (schema === LoggingMessageNotificationSchema) {
            loggingHandler = handler as typeof loggingHandler;
          }
        },
      );
    });

    // Helper to get the captured handler
    function getHandler() {
      if (!loggingHandler) throw new Error("Handler not captured");
      return loggingHandler;
    }

    it("should forward logging messages with prefixed logger field", async () => {
      const onLoggingMessage = vi.fn();

      new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
        undefined, // onResourceListChanged
        undefined, // onPromptListChanged
        undefined, // onToolListChanged
        undefined, // dangerouslyEnableSampling
        onLoggingMessage,
      );

      await getHandler()({
        params: {
          level: "info",
          logger: "my-logger",
          data: { message: "test log" },
        },
      });

      expect(onLoggingMessage).toHaveBeenCalledWith({
        level: "info",
        logger: "[test-server] my-logger",
        data: { message: "test log" },
      });
    });

    it("should use server name as logger when no logger provided", async () => {
      const onLoggingMessage = vi.fn();

      new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
        undefined,
        undefined,
        undefined,
        undefined,
        onLoggingMessage,
      );

      await getHandler()({
        params: {
          level: "warning",
          data: "simple string data",
        },
      });

      expect(onLoggingMessage).toHaveBeenCalledWith({
        level: "warning",
        logger: "[test-server]",
        data: "simple string data",
      });
    });

    it("should preserve structured data field unchanged", async () => {
      const onLoggingMessage = vi.fn();

      new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
        undefined,
        undefined,
        undefined,
        undefined,
        onLoggingMessage,
      );

      const complexData = {
        nested: { value: 42 },
        array: [1, 2, 3],
        nullValue: null,
      };

      await getHandler()({
        params: {
          level: "debug",
          logger: "complex",
          data: complexData,
        },
      });

      expect(onLoggingMessage).toHaveBeenCalledWith({
        level: "debug",
        logger: "[test-server] complex",
        data: complexData,
      });
    });

    it("should handle errors in handler without crashing", async () => {
      const onLoggingMessage = vi.fn().mockImplementation(() => {
        throw new Error("Handler error");
      });

      new MCPClientSession(
        mockClient,
        serverName,
        undefined,
        logger,
        undefined,
        undefined,
        undefined,
        undefined,
        onLoggingMessage,
      );

      // Should not throw
      await expect(
        getHandler()({
          params: {
            level: "error",
            data: "test",
          },
        }),
      ).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error handling logging notification"),
      );
    });

    it("should not call callback if not provided", async () => {
      // Create session without logging callback
      new MCPClientSession(mockClient, serverName, undefined, logger);

      // Should not throw when handler is called without callback
      await expect(
        getHandler()({
          params: {
            level: "info",
            data: "test",
          },
        }),
      ).resolves.not.toThrow();

      // Should still log the message to pino
      expect(logger.info).toHaveBeenCalled();
    });

    describe("MCP to pino level mapping", () => {
      it("should log MCP debug level to pino debug", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "debug", data: "debug message" },
        });

        expect(logger.debug).toHaveBeenCalledWith(
          expect.objectContaining({ mcpLevel: "debug" }),
          expect.stringContaining("debug message"),
        );
      });

      it("should log MCP info level to pino info", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "info", data: "info message" },
        });

        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({ mcpLevel: "info" }),
          expect.stringContaining("info message"),
        );
      });

      it("should log MCP notice level to pino info", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "notice", data: "notice message" },
        });

        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({ mcpLevel: "notice" }),
          expect.stringContaining("notice message"),
        );
      });

      it("should log MCP warning level to pino warn", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "warning", data: "warning message" },
        });

        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ mcpLevel: "warning" }),
          expect.stringContaining("warning message"),
        );
      });

      it("should log MCP error level to pino error", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "error", data: "error message" },
        });

        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ mcpLevel: "error" }),
          expect.stringContaining("error message"),
        );
      });

      it("should log MCP critical level to pino error", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "critical", data: "critical message" },
        });

        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ mcpLevel: "critical" }),
          expect.stringContaining("critical message"),
        );
      });

      it("should log MCP alert level to pino fatal", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "alert", data: "alert message" },
        });

        expect(logger.fatal).toHaveBeenCalledWith(
          expect.objectContaining({ mcpLevel: "alert" }),
          expect.stringContaining("alert message"),
        );
      });

      it("should log MCP emergency level to pino fatal", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "emergency", data: "emergency message" },
        });

        expect(logger.fatal).toHaveBeenCalledWith(
          expect.objectContaining({ mcpLevel: "emergency" }),
          expect.stringContaining("emergency message"),
        );
      });
    });

    describe("structured logging context", () => {
      it("should include mcpServer in log context", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "info", data: "test" },
        });

        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({ mcpServer: serverName }),
          expect.any(String),
        );
      });

      it("should include mcpLogger in log context", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "info", logger: "database", data: "test" },
        });

        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({ mcpLogger: "database" }),
          expect.any(String),
        );
      });

      it("should include mcpLevel in log context", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "warning", data: "test" },
        });

        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ mcpLevel: "warning" }),
          expect.any(String),
        );
      });

      it("should include full data in log context", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        const testData = { pool_size: 10, connections: 5 };
        await getHandler()({
          params: { level: "info", data: testData },
        });

        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({ data: testData }),
          expect.any(String),
        );
      });
    });

    describe("data formatting in message", () => {
      it("should include string data directly in message", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "info", data: "Connection pool exhausted!" },
        });

        expect(logger.info).toHaveBeenCalledWith(
          expect.any(Object),
          expect.stringContaining("Connection pool exhausted!"),
        );
      });

      it("should stringify object data in message", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "info", data: { count: 42 } },
        });

        expect(logger.info).toHaveBeenCalledWith(
          expect.any(Object),
          expect.stringContaining('{"count":42}'),
        );
      });

      it("should truncate long data in message", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        const longData = { message: "x".repeat(300) };
        await getHandler()({
          params: { level: "info", data: longData },
        });

        // Check that message is truncated (ends with ...)
        expect(logger.info).toHaveBeenCalledWith(
          expect.any(Object),
          expect.stringMatching(/\.\.\.$/),
        );
      });

      it("should handle null data gracefully", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "info", data: null },
        });

        expect(logger.info).toHaveBeenCalled();
      });

      it("should handle undefined data gracefully", async () => {
        new MCPClientSession(mockClient, serverName, undefined, logger);

        await getHandler()({
          params: { level: "info", data: undefined },
        });

        expect(logger.info).toHaveBeenCalled();
      });
    });

    describe("forwarding still works alongside logging", () => {
      it("should both log and forward messages", async () => {
        const onLoggingMessage = vi.fn();

        new MCPClientSession(
          mockClient,
          serverName,
          undefined,
          logger,
          undefined,
          undefined,
          undefined,
          undefined,
          onLoggingMessage,
        );

        await getHandler()({
          params: {
            level: "warning",
            logger: "api",
            data: { error: "timeout" },
          },
        });

        // Both should happen
        expect(logger.warn).toHaveBeenCalled();
        expect(onLoggingMessage).toHaveBeenCalledWith({
          level: "warning",
          logger: "[test-server] api",
          data: { error: "timeout" },
        });
      });
    });
  });
});
