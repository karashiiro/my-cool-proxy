import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateMessageRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ACPAgentConfig } from "@my-cool-proxy/acp-client";
import type { ILogger } from "../types/interfaces.js";

// Mock the acp-client package
vi.mock("@my-cool-proxy/acp-client", () => ({
  ACPClient: vi.fn(),
}));

// Mock the mappers
vi.mock("../utils/mcp-acp-mappers.js", () => ({
  mapMcpToAcpPrompt: vi.fn(),
  mapAcpToMcpResult: vi.fn(),
}));

const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

describe("SamplingPonyfill", () => {
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
    const { ACPClient } = await import("@my-cool-proxy/acp-client");
    vi.mocked(ACPClient).mockImplementation(function () {
      return mockAcpClient as never;
    });

    // Configure mapper mocks
    const mappers = await import("../utils/mcp-acp-mappers.js");
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
      const { SamplingPonyfill } = await import("./sampling-ponyfill.js");
      const { ACPClient } = await import("@my-cool-proxy/acp-client");

      const ponyfill = new SamplingPonyfill(agentConfig, createMockLogger());
      await ponyfill.initialize("session-1");

      expect(ACPClient).toHaveBeenCalledWith(agentConfig, expect.anything());
      expect(mockAcpClient.connect).toHaveBeenCalled();
    });

    it("should throw if called twice for the same session", async () => {
      const { SamplingPonyfill } = await import("./sampling-ponyfill.js");

      const ponyfill = new SamplingPonyfill(agentConfig, createMockLogger());
      await ponyfill.initialize("session-1");

      await expect(ponyfill.initialize("session-1")).rejects.toThrow(
        /already initialized/,
      );
    });

    it("should store the client for the session", async () => {
      const { SamplingPonyfill } = await import("./sampling-ponyfill.js");

      const ponyfill = new SamplingPonyfill(agentConfig, createMockLogger());
      await ponyfill.initialize("session-1");

      // Should not throw - session is now initialized
      const params: CreateMessageRequest["params"] = {
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        maxTokens: 100,
      };
      await expect(
        ponyfill.handleSamplingRequest("session-1", params),
      ).resolves.toBeDefined();
    });
  });

  describe("handleSamplingRequest", () => {
    it("should create a session, map request, call prompt, and map result", async () => {
      const { SamplingPonyfill } = await import("./sampling-ponyfill.js");
      const mappers = await import("../utils/mcp-acp-mappers.js");

      const ponyfill = new SamplingPonyfill(agentConfig, createMockLogger());
      await ponyfill.initialize("session-1");

      const params: CreateMessageRequest["params"] = {
        messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
        maxTokens: 100,
      };

      const result = await ponyfill.handleSamplingRequest("session-1", params);

      // Should map MCP params to ACP prompt with agent's prompt capabilities
      expect(mappers.mapMcpToAcpPrompt).toHaveBeenCalledWith(params, {
        image: true,
        audio: true,
      });

      // Should create an ACP session
      expect(mockAcpClient.createSession).toHaveBeenCalled();

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
      const { SamplingPonyfill } = await import("./sampling-ponyfill.js");

      const ponyfill = new SamplingPonyfill(agentConfig, createMockLogger());

      const params: CreateMessageRequest["params"] = {
        messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
        maxTokens: 100,
      };

      await expect(
        ponyfill.handleSamplingRequest("nonexistent", params),
      ).rejects.toThrow(/not initialized/);
    });
  });

  describe("close", () => {
    it("should close the ACPClient for the session", async () => {
      const { SamplingPonyfill } = await import("./sampling-ponyfill.js");

      const ponyfill = new SamplingPonyfill(agentConfig, createMockLogger());
      await ponyfill.initialize("session-1");
      await ponyfill.close("session-1");

      expect(mockAcpClient.close).toHaveBeenCalled();
    });

    it("should remove the session from the map after closing", async () => {
      const { SamplingPonyfill } = await import("./sampling-ponyfill.js");

      const ponyfill = new SamplingPonyfill(agentConfig, createMockLogger());
      await ponyfill.initialize("session-1");
      await ponyfill.close("session-1");

      const params: CreateMessageRequest["params"] = {
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        maxTokens: 100,
      };

      await expect(
        ponyfill.handleSamplingRequest("session-1", params),
      ).rejects.toThrow(/not initialized/);
    });

    it("should be safe to close a non-existent session", async () => {
      const { SamplingPonyfill } = await import("./sampling-ponyfill.js");

      const ponyfill = new SamplingPonyfill(agentConfig, createMockLogger());

      // Should not throw
      await ponyfill.close("nonexistent");
    });
  });

  describe("closeAll", () => {
    it("should close all initialized sessions", async () => {
      const { SamplingPonyfill } = await import("./sampling-ponyfill.js");
      const { ACPClient } = await import("@my-cool-proxy/acp-client");

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

      const ponyfill = new SamplingPonyfill(agentConfig, createMockLogger());
      await ponyfill.initialize("session-1");
      await ponyfill.initialize("session-2");

      await ponyfill.closeAll();

      expect(mockClient1.close).toHaveBeenCalled();
      expect(mockClient2.close).toHaveBeenCalled();
    });

    it("should clear the session map after closing all", async () => {
      const { SamplingPonyfill } = await import("./sampling-ponyfill.js");

      const ponyfill = new SamplingPonyfill(agentConfig, createMockLogger());
      await ponyfill.initialize("session-1");

      await ponyfill.closeAll();

      const params: CreateMessageRequest["params"] = {
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        maxTokens: 100,
      };

      await expect(
        ponyfill.handleSamplingRequest("session-1", params),
      ).rejects.toThrow(/not initialized/);
    });
  });
});
