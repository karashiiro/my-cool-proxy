import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PromptAggregationService } from "./prompt-aggregation-service.js";
import type { IMCPClientManager, IMCPClientSession, ILogger } from "./types.js";
import type { IResourceRoutingService } from "./resource-routing-service.js";
import type {
  Prompt,
  GetPromptResult,
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
  prompts?: Prompt[];
  promptResult?: GetPromptResult;
}): IMCPClientSession {
  return {
    listTools: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue([]),
    readResource: vi.fn().mockResolvedValue({ contents: [] }),
    listPrompts: vi.fn().mockResolvedValue(options.prompts ?? []),
    getPrompt: vi
      .fn()
      .mockResolvedValue(options.promptResult ?? { messages: [] }),
    getServerVersion: vi.fn().mockReturnValue({}),
    getInstructions: vi.fn().mockReturnValue(undefined),
    listResourceTemplates: vi.fn().mockResolvedValue([]),
    complete: vi.fn().mockResolvedValue({ completion: { values: [] } }),
  };
}

describe("PromptAggregationService", () => {
  let service: PromptAggregationService;
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

    service = new PromptAggregationService(
      mockClientManager,
      mockLogger,
      mockRoutingService,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("listPrompts", () => {
    it("should aggregate prompts from multiple servers", async () => {
      const server1Prompts: Prompt[] = [
        { name: "prompt1", description: "First prompt" },
        { name: "prompt2", description: "Second prompt" },
      ];
      const server2Prompts: Prompt[] = [
        { name: "promptA", description: "Prompt A" },
      ];

      const mockClient1 = createMockClientSession({ prompts: server1Prompts });
      const mockClient2 = createMockClientSession({ prompts: server2Prompts });

      const clientsMap = new Map([
        ["server1", mockClient1],
        ["server2", mockClient2],
      ]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const result = await service.listPrompts("session-123");

      expect(result.prompts).toHaveLength(3);
      expect(result.prompts[0]?.name).toBe("server1/prompt1");
      expect(result.prompts[1]?.name).toBe("server1/prompt2");
      expect(result.prompts[2]?.name).toBe("server2/promptA");
    });

    it("should return empty array when no clients available", async () => {
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        new Map(),
      );

      const result = await service.listPrompts("session-123");

      expect(result.prompts).toEqual([]);
    });

    it("should use 'default' session when sessionId is empty", async () => {
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        new Map(),
      );

      await service.listPrompts("");

      expect(mockClientManager.getClientsBySession).toHaveBeenCalledWith(
        "default",
      );
    });

    it("should cache results", async () => {
      const prompts: Prompt[] = [{ name: "cached-prompt" }];
      const mockClient = createMockClientSession({ prompts });

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      await service.listPrompts("session-123");
      await service.listPrompts("session-123");

      expect(mockClient.listPrompts).toHaveBeenCalledTimes(1);
    });

    it("should handle server errors gracefully", async () => {
      const workingPrompts: Prompt[] = [{ name: "working-prompt" }];
      const mockWorkingClient = createMockClientSession({
        prompts: workingPrompts,
      });
      const mockFailingClient = createMockClientSession({});
      vi.mocked(mockFailingClient.listPrompts).mockRejectedValue(
        new Error("Connection lost"),
      );

      const clientsMap = new Map([
        ["working-server", mockWorkingClient],
        ["failing-server", mockFailingClient],
      ]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const result = await service.listPrompts("session-123");

      expect(result.prompts).toHaveLength(1);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("getPrompt", () => {
    it("should retrieve a prompt from the correct server", async () => {
      const mockResult: GetPromptResult = {
        description: "Retrieved prompt",
        messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
      };
      const mockClient = createMockClientSession({ promptResult: mockResult });

      const clientsMap = new Map([["my-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const result = await service.getPrompt(
        "my-server/my-prompt",
        { arg1: "value1" },
        "session-123",
      );

      expect(mockClient.getPrompt).toHaveBeenCalledWith({
        name: "my-prompt",
        arguments: { arg1: "value1" },
      });
      expect(result.description).toBe("Retrieved prompt");
    });

    it("should throw error for invalid prompt name format", async () => {
      await expect(
        service.getPrompt("invalid-name-no-slash", undefined, "session-123"),
      ).rejects.toThrow("Invalid prompt name format");
    });

    it("should throw error when server not found", async () => {
      const mockClient = createMockClientSession({});
      const clientsMap = new Map([["other-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      await expect(
        service.getPrompt("unknown-server/my-prompt", undefined, "session-123"),
      ).rejects.toThrow("not found");
    });

    it("should handle prompt names with multiple slashes", async () => {
      const mockResult: GetPromptResult = { messages: [] };
      const mockClient = createMockClientSession({ promptResult: mockResult });

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      await service.getPrompt(
        "server1/nested/prompt/name",
        undefined,
        "session-123",
      );

      expect(mockClient.getPrompt).toHaveBeenCalledWith({
        name: "nested/prompt/name",
        arguments: undefined,
      });
    });

    it("should register resource URIs from prompt result for routing", async () => {
      const mockResult: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "resource_link",
              uri: "file:///docs/README.md",
            } as GetPromptResult["messages"][0]["content"],
          },
        ],
      };
      const mockClient = createMockClientSession({ promptResult: mockResult });

      const clientsMap = new Map([["docs-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const result = await service.getPrompt(
        "docs-server/my-prompt",
        undefined,
        "session-123",
      );

      // Should register the resource URI for future routing
      expect(mockRoutingService.registerEncounteredUri).toHaveBeenCalledWith(
        "session-123",
        "file:///docs/README.md",
        "docs-server",
      );

      // Result should be returned unchanged (no gw:// namespacing)
      const content = result.messages[0]?.content as { uri?: string };
      expect(content?.uri).toBe("file:///docs/README.md");
    });

    it("should register resource URIs from embedded resource content blocks", async () => {
      const mockResult: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "resource",
              resource: {
                uri: "file:///data/config.json",
                mimeType: "application/json",
                text: '{"key": "value"}',
              },
            } as GetPromptResult["messages"][0]["content"],
          },
        ],
      };
      const mockClient = createMockClientSession({ promptResult: mockResult });

      const clientsMap = new Map([["config-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      await service.getPrompt(
        "config-server/my-prompt",
        undefined,
        "session-123",
      );

      expect(mockRoutingService.registerEncounteredUri).toHaveBeenCalledWith(
        "session-123",
        "file:///data/config.json",
        "config-server",
      );
    });

    it("should register URIs from both resource_link and embedded resource in same result", async () => {
      const mockResult: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "resource_link",
              uri: "file:///link.md",
            } as GetPromptResult["messages"][0]["content"],
          },
          {
            role: "assistant",
            content: {
              type: "resource",
              resource: {
                uri: "file:///embedded.json",
                mimeType: "application/json",
                text: "{}",
              },
            } as GetPromptResult["messages"][0]["content"],
          },
        ],
      };
      const mockClient = createMockClientSession({ promptResult: mockResult });

      const clientsMap = new Map([["multi-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      await service.getPrompt(
        "multi-server/my-prompt",
        undefined,
        "session-123",
      );

      expect(mockRoutingService.registerEncounteredUri).toHaveBeenCalledTimes(
        2,
      );
      expect(mockRoutingService.registerEncounteredUri).toHaveBeenCalledWith(
        "session-123",
        "file:///link.md",
        "multi-server",
      );
      expect(mockRoutingService.registerEncounteredUri).toHaveBeenCalledWith(
        "session-123",
        "file:///embedded.json",
        "multi-server",
      );
    });

    it("should not register URIs for text-only message content", async () => {
      const mockResult: GetPromptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Just a plain text message",
            },
          },
          {
            role: "assistant",
            content: {
              type: "text",
              text: "Another plain text response",
            },
          },
        ],
      };
      const mockClient = createMockClientSession({ promptResult: mockResult });

      const clientsMap = new Map([["text-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      await service.getPrompt(
        "text-server/my-prompt",
        undefined,
        "session-123",
      );

      expect(mockRoutingService.registerEncounteredUri).not.toHaveBeenCalled();
    });
  });

  describe("handlePromptListChanged", () => {
    it("should invalidate cache for the session", async () => {
      const prompts: Prompt[] = [{ name: "cached-prompt" }];
      const mockClient = createMockClientSession({ prompts });

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      // Populate cache
      await service.listPrompts("session-123");
      expect(mockClient.listPrompts).toHaveBeenCalledTimes(1);

      // Invalidate cache
      service.handlePromptListChanged("server1", "session-123");

      // Should fetch again
      await service.listPrompts("session-123");
      expect(mockClient.listPrompts).toHaveBeenCalledTimes(2);
    });
  });
});
