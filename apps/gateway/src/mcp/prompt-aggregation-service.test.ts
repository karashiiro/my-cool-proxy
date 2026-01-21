import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TestBed } from "@suites/unit";
import { PromptAggregationService } from "./prompt-aggregation-service.js";
import { TYPES } from "../types/index.js";
import type { MCPClientSession } from "./client-session.js";
import type {
  Prompt,
  GetPromptResult,
} from "@modelcontextprotocol/sdk/types.js";

describe("PromptAggregationService", () => {
  let service: PromptAggregationService;
  let mockClientManager: ReturnType<typeof unitRef.get>;
  let mockLogger: ReturnType<typeof unitRef.get>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let unitRef: any;

  beforeEach(async () => {
    const { unit, unitRef: ref } = await TestBed.solitary(
      PromptAggregationService,
    ).compile();
    service = unit;
    unitRef = ref;
    mockClientManager = unitRef.get(TYPES.MCPClientManager);
    mockLogger = unitRef.get(TYPES.Logger);
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

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient1 as unknown as MCPClientSession],
        ["server2", mockClient2 as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listPrompts("session-123");

      expect(result.prompts).toHaveLength(3);
      expect(result.prompts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "server1/prompt1" }),
          expect.objectContaining({ name: "server1/prompt2" }),
          expect.objectContaining({ name: "server2/promptA" }),
        ]),
      );
    });

    it("should return empty array when no clients available", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listPrompts("session-123");

      expect(result.prompts).toEqual([]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        "No clients available for session 'session-123'",
      );
    });

    it("should use 'default' session when sessionId is empty", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await service.listPrompts("");

      expect(mockClientManager.getClientsBySession).toHaveBeenCalledWith(
        "default",
      );
    });

    it("should cache results and return cached prompts on subsequent calls", async () => {
      const serverPrompts: Prompt[] = [{ name: "cached-prompt" }];
      const mockClient = createMockClientSession({ prompts: serverPrompts });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      // First call - should fetch from clients
      const result1 = await service.listPrompts("session-123");

      // Second call - should return cached
      const result2 = await service.listPrompts("session-123");

      expect(mockClient.listPrompts).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(result2);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Returning cached prompt list for session 'session-123'",
      );
    });

    it("should handle server errors gracefully and continue aggregation", async () => {
      const workingPrompts: Prompt[] = [{ name: "working-prompt" }];
      const mockWorkingClient = createMockClientSession({
        prompts: workingPrompts,
      });
      const mockFailingClient = createMockClientSession({});
      mockFailingClient.listPrompts.mockRejectedValue(
        new Error("Connection lost"),
      );

      const clientsMap = new Map<string, MCPClientSession>([
        ["working-server", mockWorkingClient as unknown as MCPClientSession],
        ["failing-server", mockFailingClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listPrompts("session-123");

      expect(result.prompts).toHaveLength(1);
      expect(result.prompts[0]!.name).toBe("working-server/working-prompt");
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to list prompts from server 'failing-server':",
        expect.any(Error),
      );
    });

    it("should silently ignore 'Server does not support prompts' errors", async () => {
      const mockClient = createMockClientSession({});
      mockClient.listPrompts.mockRejectedValue(
        new Error("Server does not support prompts"),
      );

      const clientsMap = new Map<string, MCPClientSession>([
        ["no-prompts-server", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listPrompts("session-123");

      expect(result.prompts).toEqual([]);
      // Should NOT log error for this specific case
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("should namespace prompts with server name prefix", async () => {
      const serverPrompts: Prompt[] = [
        { name: "my-prompt", description: "A prompt", arguments: [] },
      ];
      const mockClient = createMockClientSession({ prompts: serverPrompts });

      const clientsMap = new Map<string, MCPClientSession>([
        ["my-server", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listPrompts("session-123");

      expect(result.prompts[0]).toEqual({
        name: "my-server/my-prompt",
        description: "A prompt",
        arguments: [],
      });
    });

    it("should log aggregation info after successful fetch", async () => {
      const serverPrompts: Prompt[] = [{ name: "p1" }, { name: "p2" }];
      const mockClient = createMockClientSession({ prompts: serverPrompts });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await service.listPrompts("session-123");

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Aggregated 2 prompts from 1 servers for session 'session-123'",
      );
    });

    it("should handle concurrent prompt fetches from multiple servers", async () => {
      const prompts1: Prompt[] = [{ name: "prompt1" }];
      const prompts2: Prompt[] = [{ name: "prompt2" }];
      const prompts3: Prompt[] = [{ name: "prompt3" }];

      const mockClient1 = createMockClientSession({ prompts: prompts1 });
      const mockClient2 = createMockClientSession({ prompts: prompts2 });
      const mockClient3 = createMockClientSession({ prompts: prompts3 });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient1 as unknown as MCPClientSession],
        ["server2", mockClient2 as unknown as MCPClientSession],
        ["server3", mockClient3 as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      const result = await service.listPrompts("session-123");

      expect(result.prompts).toHaveLength(3);
      expect(mockClient1.listPrompts).toHaveBeenCalled();
      expect(mockClient2.listPrompts).toHaveBeenCalled();
      expect(mockClient3.listPrompts).toHaveBeenCalled();
    });
  });

  describe("getPrompt", () => {
    it("should retrieve a prompt from the correct server", async () => {
      const mockResult: GetPromptResult = {
        description: "Retrieved prompt",
        messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
      };
      const mockClient = createMockClientSession({ promptResult: mockResult });

      const clientsMap = new Map<string, MCPClientSession>([
        ["my-server", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

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
      const clientsMap = new Map<string, MCPClientSession>();
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await expect(
        service.getPrompt("invalid-name-no-slash", undefined, "session-123"),
      ).rejects.toThrow(
        "Invalid prompt name format: 'invalid-name-no-slash'. Expected format: {server-name}/{prompt-name}",
      );
    });

    it("should throw error when server not found", async () => {
      const mockClient = createMockClientSession({});
      const clientsMap = new Map<string, MCPClientSession>([
        ["other-server", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await expect(
        service.getPrompt("unknown-server/my-prompt", undefined, "session-123"),
      ).rejects.toThrow(
        "Server 'unknown-server' not found in session 'session-123'. Available servers: other-server",
      );
    });

    it("should throw error when no servers available", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await expect(
        service.getPrompt("unknown-server/my-prompt", undefined, "session-123"),
      ).rejects.toThrow("Available servers: none");
    });

    it("should use 'default' session when sessionId is empty", async () => {
      const mockResult: GetPromptResult = {
        messages: [],
      };
      const mockClient = createMockClientSession({ promptResult: mockResult });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await service.getPrompt("server1/prompt1", undefined, "");

      expect(mockClientManager.getClientsBySession).toHaveBeenCalledWith(
        "default",
      );
    });

    it("should pass undefined arguments when not provided", async () => {
      const mockResult: GetPromptResult = { messages: [] };
      const mockClient = createMockClientSession({ promptResult: mockResult });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await service.getPrompt("server1/prompt1", undefined, "session-123");

      expect(mockClient.getPrompt).toHaveBeenCalledWith({
        name: "prompt1",
        arguments: undefined,
      });
    });

    it("should log debug message on successful retrieval", async () => {
      const mockResult: GetPromptResult = { messages: [] };
      const mockClient = createMockClientSession({ promptResult: mockResult });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await service.getPrompt("server1/my-prompt", undefined, "session-123");

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Got prompt 'my-prompt' from server 'server1'",
      );
    });

    it("should re-throw and log error when getPrompt fails", async () => {
      const mockClient = createMockClientSession({});
      mockClient.getPrompt.mockRejectedValue(new Error("Prompt not found"));

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await expect(
        service.getPrompt("server1/missing-prompt", undefined, "session-123"),
      ).rejects.toThrow("Prompt not found");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to get prompt 'missing-prompt' from server 'server1':",
        expect.any(Error),
      );
    });

    it("should handle prompt names with multiple slashes", async () => {
      const mockResult: GetPromptResult = { messages: [] };
      const mockClient = createMockClientSession({ promptResult: mockResult });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await service.getPrompt(
        "server1/nested/prompt/name",
        undefined,
        "session-123",
      );

      // The first slash separates server from prompt name, rest is part of prompt name
      expect(mockClient.getPrompt).toHaveBeenCalledWith({
        name: "nested/prompt/name",
        arguments: undefined,
      });
    });

    it("should throw error for empty server name", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await expect(
        service.getPrompt("/prompt-only", undefined, "session-123"),
      ).rejects.toThrow("Invalid prompt name format");
    });

    it("should throw error for empty prompt name", async () => {
      const clientsMap = new Map<string, MCPClientSession>();
      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      await expect(
        service.getPrompt("server-only/", undefined, "session-123"),
      ).rejects.toThrow("Invalid prompt name format");
    });
  });

  describe("handlePromptListChanged", () => {
    it("should invalidate cache for the session", async () => {
      const serverPrompts: Prompt[] = [{ name: "cached-prompt" }];
      const mockClient = createMockClientSession({ prompts: serverPrompts });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      // Populate cache
      await service.listPrompts("session-123");
      expect(mockClient.listPrompts).toHaveBeenCalledTimes(1);

      // Invalidate cache
      service.handlePromptListChanged("server1", "session-123");

      // Should fetch again after invalidation
      await service.listPrompts("session-123");
      expect(mockClient.listPrompts).toHaveBeenCalledTimes(2);
    });

    it("should log cache invalidation", () => {
      service.handlePromptListChanged("server1", "session-123");

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Prompt list changed for server 'server1' in session 'session-123'",
      );
    });

    it("should not affect other session caches", async () => {
      const serverPrompts: Prompt[] = [{ name: "prompt1" }];
      const mockClient = createMockClientSession({ prompts: serverPrompts });

      const clientsMap = new Map<string, MCPClientSession>([
        ["server1", mockClient as unknown as MCPClientSession],
      ]);

      mockClientManager.getClientsBySession.mockReturnValue(clientsMap);

      // Populate cache for two sessions
      await service.listPrompts("session-A");
      await service.listPrompts("session-B");

      // Invalidate only session-A
      service.handlePromptListChanged("server1", "session-A");

      // Fetch again - session-B should still be cached
      await service.listPrompts("session-B");

      // session-A was fetched once, then invalidated, so still 1 call for session-A
      // session-B was fetched once and cached, so still just 1 additional call
      // Total: 2 calls during initial population (one per session)
      // After invalidation: session-B returns cached, no new call
      expect(mockClient.listPrompts).toHaveBeenCalledTimes(2);
    });
  });
});

// Helper function to create mock client sessions
function createMockClientSession(options: {
  prompts?: Prompt[];
  promptResult?: GetPromptResult;
}): {
  listPrompts: ReturnType<typeof vi.fn>;
  getPrompt: ReturnType<typeof vi.fn>;
} {
  return {
    listPrompts: vi.fn().mockResolvedValue(options.prompts ?? []),
    getPrompt: vi
      .fn()
      .mockResolvedValue(options.promptResult ?? { messages: [] }),
  };
}
