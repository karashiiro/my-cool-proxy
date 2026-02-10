import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateMessageRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ACPAgentConfig } from "@my-cool-proxy/acp-client";
import type { ILogger } from "@my-cool-proxy/logger";
import { SamplingShim } from "./sampling-shim.js";
import { ACPClient } from "@my-cool-proxy/acp-client";
import * as mappers from "../utils/index.js";

// Mock the acp-client package
vi.mock("@my-cool-proxy/acp-client", () => ({
  ACPClient: vi.fn(),
}));

// Mock the mappers and tempdir utilities
vi.mock("../utils/index.js", () => ({
  mapMcpToAcpPrompt: vi.fn(),
  mapAcpToMcpResult: vi.fn(),
  createSessionTempDir: vi.fn((sessionId: string) => `/tmp/test-${sessionId}`),
  cleanupSessionTempDir: vi.fn(),
}));

const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

const createMockCapabilityStore = () => ({
  setCapabilities: vi.fn(),
  getCapabilities: vi.fn(),
  hasCapability: vi.fn(),
  hasElicitationMode: vi.fn(),
  deleteCapabilities: vi.fn(),
  setWorkingDirectory: vi.fn(),
  getWorkingDirectory: vi.fn().mockReturnValue("/tmp/test-session-1"),
});

describe("SamplingShim", () => {
  let mockAcpClient: {
    connect: ReturnType<typeof vi.fn>;
    createSession: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    promptCapabilities: { image?: boolean; audio?: boolean };
  };
  let mockSession: {
    prompt: ReturnType<typeof vi.fn>;
  };

  const agentConfig: ACPAgentConfig = {
    command: "node",
    args: ["agent.js"],
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockSession = {
      prompt: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "agent response" }],
        stopReason: "end_turn",
      }),
    };

    mockAcpClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockResolvedValue(mockSession),
      close: vi.fn().mockResolvedValue(undefined),
      promptCapabilities: { image: true, audio: true },
    };

    // Configure ACPClient constructor mock
    vi.mocked(ACPClient).mockImplementation(function () {
      return mockAcpClient as never;
    });

    // Configure mapper mocks
    vi.mocked(mappers.mapMcpToAcpPrompt).mockReturnValue([
      { type: "text", text: "[User]: Hello" },
    ]);
    vi.mocked(mappers.mapAcpToMcpResult).mockReturnValue({
      role: "assistant",
      content: { type: "text", text: "agent response" },
      model: "acp-agent",
      stopReason: "endTurn",
    });
  });

  describe("initialize", () => {
    it("should create an ACPClient and connect", async () => {
      const shim = new SamplingShim(
        agentConfig,
        createMockLogger(),
        createMockCapabilityStore() as never,
      );
      await shim.initialize("session-1");

      expect(ACPClient).toHaveBeenCalledWith(
        expect.objectContaining({
          config: agentConfig,
          logger: expect.anything(),
        }),
      );
      expect(mockAcpClient.connect).toHaveBeenCalled();
    });

    it("should throw if called twice for the same session", async () => {
      const shim = new SamplingShim(
        agentConfig,
        createMockLogger(),
        createMockCapabilityStore() as never,
      );
      await shim.initialize("session-1");

      await expect(shim.initialize("session-1")).rejects.toThrow(
        /already initialized/,
      );
    });

    it("should store the client for the session", async () => {
      const shim = new SamplingShim(
        agentConfig,
        createMockLogger(),
        createMockCapabilityStore() as never,
      );
      await shim.initialize("session-1");

      // Should not throw - session is now initialized
      const params: CreateMessageRequest["params"] = {
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        maxTokens: 100,
      };
      await expect(
        shim.handleSamplingRequest("session-1", params),
      ).resolves.toBeDefined();
    });
  });

  describe("handleSamplingRequest", () => {
    it("should create a session, map request, call prompt, and map result", async () => {
      const shim = new SamplingShim(
        agentConfig,
        createMockLogger(),
        createMockCapabilityStore() as never,
      );
      await shim.initialize("session-1");

      const params: CreateMessageRequest["params"] = {
        messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
        maxTokens: 100,
      };

      const result = await shim.handleSamplingRequest("session-1", params);

      // Should map MCP params to ACP prompt with agent's prompt capabilities
      expect(mappers.mapMcpToAcpPrompt).toHaveBeenCalledWith(params, {
        image: true,
        audio: true,
      });

      // Should create an ACP session with the cwd from CapabilityStore,
      // empty mcpServers array (no tools in request), and no tool tag
      expect(mockAcpClient.createSession).toHaveBeenCalledWith(
        "/tmp/test-session-1",
        [],
        undefined,
      );

      // Should call prompt with the mapped content
      expect(mockSession.prompt).toHaveBeenCalledWith([
        { type: "text", text: "[User]: Hello" },
      ]);

      // Should map ACP result back to MCP
      expect(mappers.mapAcpToMcpResult).toHaveBeenCalledWith(
        [{ type: "text", text: "agent response" }],
        "end_turn",
      );

      // Should return the mapped result
      expect(result).toEqual({
        role: "assistant",
        content: { type: "text", text: "agent response" },
        model: "acp-agent",
        stopReason: "endTurn",
      });
    });

    it("should throw for an uninitialized session", async () => {
      const shim = new SamplingShim(
        agentConfig,
        createMockLogger(),
        createMockCapabilityStore() as never,
      );

      const params: CreateMessageRequest["params"] = {
        messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
        maxTokens: 100,
      };

      await expect(
        shim.handleSamplingRequest("nonexistent", params),
      ).rejects.toThrow(/not initialized/);
    });
  });

  describe("close", () => {
    it("should close the ACPClient for the session", async () => {
      const shim = new SamplingShim(
        agentConfig,
        createMockLogger(),
        createMockCapabilityStore() as never,
      );
      await shim.initialize("session-1");
      await shim.close("session-1");

      expect(mockAcpClient.close).toHaveBeenCalled();
    });

    it("should remove the session from the map after closing", async () => {
      const shim = new SamplingShim(
        agentConfig,
        createMockLogger(),
        createMockCapabilityStore() as never,
      );
      await shim.initialize("session-1");
      await shim.close("session-1");

      const params: CreateMessageRequest["params"] = {
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        maxTokens: 100,
      };

      await expect(
        shim.handleSamplingRequest("session-1", params),
      ).rejects.toThrow(/not initialized/);
    });

    it("should be safe to close a non-existent session", async () => {
      const shim = new SamplingShim(
        agentConfig,
        createMockLogger(),
        createMockCapabilityStore() as never,
      );

      // Should not throw
      await shim.close("nonexistent");
    });
  });

  describe("closeAll", () => {
    it("should close all initialized sessions", async () => {
      // Create separate mock clients for each session
      const mockClient1 = {
        connect: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockClient2 = {
        connect: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      let callCount = 0;
      vi.mocked(ACPClient).mockImplementation(function () {
        callCount++;
        return (callCount === 1 ? mockClient1 : mockClient2) as never;
      });

      const shim = new SamplingShim(
        agentConfig,
        createMockLogger(),
        createMockCapabilityStore() as never,
      );
      await shim.initialize("session-1");
      await shim.initialize("session-2");

      await shim.closeAll();

      expect(mockClient1.close).toHaveBeenCalled();
      expect(mockClient2.close).toHaveBeenCalled();
    });

    it("should clear the session map after closing all", async () => {
      const shim = new SamplingShim(
        agentConfig,
        createMockLogger(),
        createMockCapabilityStore() as never,
      );
      await shim.initialize("session-1");

      await shim.closeAll();

      const params: CreateMessageRequest["params"] = {
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        maxTokens: 100,
      };

      await expect(
        shim.handleSamplingRequest("session-1", params),
      ).rejects.toThrow(/not initialized/);
    });
  });
});
