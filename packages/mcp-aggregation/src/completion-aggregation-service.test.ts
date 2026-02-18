import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CompletionAggregationService } from "./completion-aggregation-service.js";
import type { IMCPClientManager, IMCPClientSession, ILogger } from "./types.js";
import type { IResourceRoutingService } from "./resource-routing-service.js";
import type {
  CompleteRequest,
  CompleteResult,
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
function createMockClientSession(options?: {
  completeResult?: CompleteResult;
}): IMCPClientSession {
  return {
    listTools: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue([]),
    readResource: vi.fn().mockResolvedValue({ contents: [] }),
    listPrompts: vi.fn().mockResolvedValue([]),
    getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
    getServerVersion: vi.fn().mockReturnValue({}),
    getInstructions: vi.fn().mockReturnValue(undefined),
    listResourceTemplates: vi.fn().mockResolvedValue([]),
    complete: vi
      .fn()
      .mockResolvedValue(
        options?.completeResult ?? { completion: { values: [] } },
      ),
  };
}

describe("CompletionAggregationService", () => {
  let service: CompletionAggregationService;
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

    service = new CompletionAggregationService(
      mockClientManager,
      mockLogger,
      mockRoutingService,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("complete with ref/prompt", () => {
    it("should de-namespace prompt ref and forward to correct server", async () => {
      const completeResult: CompleteResult = {
        completion: { values: ["typescript", "terraform"], hasMore: false },
      };
      const mockClient = createMockClientSession({ completeResult });

      const clientsMap = new Map([["my-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const params: CompleteRequest["params"] = {
        ref: { type: "ref/prompt", name: "my-server/code-review" },
        argument: { name: "language", value: "ty" },
      };

      const result = await service.complete(params, "session-123");

      expect(mockClient.complete).toHaveBeenCalledWith({
        ref: { type: "ref/prompt", name: "code-review" },
        argument: { name: "language", value: "ty" },
      });
      expect(result.completion.values).toEqual(["typescript", "terraform"]);
    });

    it("should handle prompt names with multiple slashes", async () => {
      const mockClient = createMockClientSession();

      const clientsMap = new Map([["server1", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const params: CompleteRequest["params"] = {
        ref: { type: "ref/prompt", name: "server1/nested/prompt/name" },
        argument: { name: "arg1", value: "val" },
      };

      await service.complete(params, "session-123");

      expect(mockClient.complete).toHaveBeenCalledWith({
        ref: { type: "ref/prompt", name: "nested/prompt/name" },
        argument: { name: "arg1", value: "val" },
      });
    });

    it("should throw error for invalid prompt name format (no slash)", async () => {
      const params: CompleteRequest["params"] = {
        ref: { type: "ref/prompt", name: "invalid-no-slash" },
        argument: { name: "arg", value: "" },
      };

      await expect(service.complete(params, "session-123")).rejects.toThrow(
        "Invalid prompt name format",
      );
    });

    it("should throw error when server not found for prompt ref", async () => {
      const mockClient = createMockClientSession();
      const clientsMap = new Map([["other-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const params: CompleteRequest["params"] = {
        ref: { type: "ref/prompt", name: "unknown-server/my-prompt" },
        argument: { name: "arg", value: "" },
      };

      await expect(service.complete(params, "session-123")).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("complete with ref/resource", () => {
    it("should route resource ref via routing service and forward to correct server", async () => {
      const completeResult: CompleteResult = {
        completion: { values: ["us-east-1", "us-west-2"], hasMore: false },
      };
      const mockClient = createMockClientSession({ completeResult });

      const clientsMap = new Map([["completions-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );
      vi.mocked(mockRoutingService.getServerForUri).mockReturnValue(
        "completions-server",
      );

      // URI is the original template — no gw:// wrapping, no percent-encoding
      const params: CompleteRequest["params"] = {
        ref: {
          type: "ref/resource",
          uri: "deployment://{region}/{service}",
        },
        argument: { name: "region", value: "us" },
      };

      const result = await service.complete(params, "session-123");

      expect(mockRoutingService.getServerForUri).toHaveBeenCalledWith(
        "session-123",
        "deployment://{region}/{service}",
      );
      // URI should be passed through unchanged to upstream
      expect(mockClient.complete).toHaveBeenCalledWith({
        ref: {
          type: "ref/resource",
          uri: "deployment://{region}/{service}",
        },
        argument: { name: "region", value: "us" },
      });
      expect(result.completion.values).toEqual(["us-east-1", "us-west-2"]);
    });

    it("should throw error when no route found for resource URI", async () => {
      vi.mocked(mockRoutingService.getServerForUri).mockReturnValue(undefined);

      const params: CompleteRequest["params"] = {
        ref: { type: "ref/resource", uri: "unknown://{var}" },
        argument: { name: "var", value: "" },
      };

      await expect(service.complete(params, "session-123")).rejects.toThrow(
        "No route found for resource URI",
      );
    });

    it("should throw error when server not found in client pool for resource ref", async () => {
      vi.mocked(mockRoutingService.getServerForUri).mockReturnValue(
        "missing-server",
      );
      const mockClient = createMockClientSession();
      const clientsMap = new Map([["other-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const params: CompleteRequest["params"] = {
        ref: {
          type: "ref/resource",
          uri: "deployment://{region}",
        },
        argument: { name: "region", value: "" },
      };

      await expect(service.complete(params, "session-123")).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("unknown ref type", () => {
    it("should throw error for unknown ref type", async () => {
      const params = {
        ref: { type: "ref/unknown" as "ref/prompt", name: "something" },
        argument: { name: "arg", value: "" },
      };

      await expect(service.complete(params, "session-123")).rejects.toThrow(
        "Unknown completion ref type",
      );
    });
  });

  describe("session handling", () => {
    it("should use 'default' session when sessionId is empty", async () => {
      const mockClient = createMockClientSession();
      const clientsMap = new Map([["my-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const params: CompleteRequest["params"] = {
        ref: { type: "ref/prompt", name: "my-server/prompt" },
        argument: { name: "arg", value: "" },
      };

      await service.complete(params, "");

      expect(mockClientManager.getClientsBySession).toHaveBeenCalledWith(
        "default",
      );
    });
  });

  describe("error handling", () => {
    it("should log and rethrow upstream completion errors", async () => {
      const mockClient = createMockClientSession();
      vi.mocked(mockClient.complete).mockRejectedValue(
        new Error("Upstream error"),
      );

      const clientsMap = new Map([["my-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const params: CompleteRequest["params"] = {
        ref: { type: "ref/prompt", name: "my-server/prompt" },
        argument: { name: "arg", value: "" },
      };

      await expect(service.complete(params, "session-123")).rejects.toThrow(
        "Upstream error",
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to complete from server"),
        expect.any(Error),
      );
    });
  });

  describe("context passthrough", () => {
    it("should forward context alongside argument when present", async () => {
      const mockClient = createMockClientSession();
      const clientsMap = new Map([["my-server", mockClient]]);
      vi.mocked(mockClientManager.getClientsBySession).mockReturnValue(
        clientsMap,
      );

      const params: CompleteRequest["params"] = {
        ref: { type: "ref/prompt", name: "my-server/code-review" },
        argument: { name: "framework", value: "re" },
        context: {
          arguments: { language: "typescript" },
        },
      };

      await service.complete(params, "session-123");

      expect(mockClient.complete).toHaveBeenCalledWith({
        ref: { type: "ref/prompt", name: "code-review" },
        argument: { name: "framework", value: "re" },
        context: {
          arguments: { language: "typescript" },
        },
      });
    });
  });
});
