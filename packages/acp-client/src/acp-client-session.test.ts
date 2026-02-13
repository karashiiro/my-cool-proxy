import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import {
  ACPClientSession,
  type PromptFunction,
  type RegisterHandlerFunction,
  type DeregisterHandlerFunction,
} from "./acp-client-session.js";

describe("ACPClientSession", () => {
  let promptFn: PromptFunction;
  let registerHandler: RegisterHandlerFunction;
  let deregisterHandler: DeregisterHandlerFunction;
  const sessionId = "test-session-123";

  beforeEach(() => {
    promptFn = vi.fn();
    registerHandler = vi.fn();
    deregisterHandler = vi.fn();
  });

  describe("prompt", () => {
    it("should register handler, call prompt, and return accumulated content blocks", async () => {
      // Simulate the agent sending content blocks during prompt
      vi.mocked(registerHandler).mockImplementation((_id, handler) => {
        handler({ type: "text", text: "Hello " } as ContentBlock);
        handler({ type: "text", text: "world!" } as ContentBlock);
      });

      vi.mocked(promptFn).mockResolvedValue({ stopReason: "end_turn" });

      const session = new ACPClientSession(
        sessionId,
        promptFn,
        registerHandler,
        deregisterHandler,
      );

      const result = await session.prompt([
        { type: "text", text: "Say hello" } as ContentBlock,
      ]);

      expect(result).toEqual({
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world!" },
        ],
        stopReason: "end_turn",
      });
    });

    it("should accumulate non-text content blocks", async () => {
      const imageBlock = {
        type: "image",
        data: "base64data",
        mimeType: "image/png",
      } as ContentBlock;

      vi.mocked(registerHandler).mockImplementation((_id, handler) => {
        handler({ type: "text", text: "Here is an image:" } as ContentBlock);
        handler(imageBlock);
      });

      vi.mocked(promptFn).mockResolvedValue({ stopReason: "end_turn" });

      const session = new ACPClientSession(
        sessionId,
        promptFn,
        registerHandler,
        deregisterHandler,
      );

      const result = await session.prompt([
        { type: "text", text: "Generate image" } as ContentBlock,
      ]);

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Here is an image:",
      });
      expect(result.content[1]).toEqual(imageBlock);
    });

    it("should register handler with the correct session ID", async () => {
      vi.mocked(promptFn).mockResolvedValue({ stopReason: "end_turn" });

      const session = new ACPClientSession(
        sessionId,
        promptFn,
        registerHandler,
        deregisterHandler,
      );

      await session.prompt([{ type: "text", text: "test" } as ContentBlock]);

      expect(registerHandler).toHaveBeenCalledWith(
        sessionId,
        expect.any(Function),
      );
    });

    it("should pass session ID and content to prompt function", async () => {
      vi.mocked(promptFn).mockResolvedValue({ stopReason: "end_turn" });

      const session = new ACPClientSession(
        sessionId,
        promptFn,
        registerHandler,
        deregisterHandler,
      );

      const content = [
        { type: "text", text: "Hello" } as ContentBlock,
        { type: "text", text: "World" } as ContentBlock,
      ];

      await session.prompt(content);

      expect(promptFn).toHaveBeenCalledWith(sessionId, content);
    });

    it("should deregister handler after successful prompt", async () => {
      vi.mocked(promptFn).mockResolvedValue({ stopReason: "end_turn" });

      const session = new ACPClientSession(
        sessionId,
        promptFn,
        registerHandler,
        deregisterHandler,
      );

      await session.prompt([{ type: "text", text: "test" } as ContentBlock]);

      expect(deregisterHandler).toHaveBeenCalledWith(sessionId);
    });

    it("should deregister handler even when prompt fails", async () => {
      vi.mocked(promptFn).mockRejectedValue(new Error("Agent crashed"));

      const session = new ACPClientSession(
        sessionId,
        promptFn,
        registerHandler,
        deregisterHandler,
      );

      await expect(
        session.prompt([{ type: "text", text: "test" } as ContentBlock]),
      ).rejects.toThrow("Agent crashed");

      expect(deregisterHandler).toHaveBeenCalledWith(sessionId);
    });

    it("should return empty content when no blocks are received", async () => {
      vi.mocked(promptFn).mockResolvedValue({ stopReason: "end_turn" });

      const session = new ACPClientSession(
        sessionId,
        promptFn,
        registerHandler,
        deregisterHandler,
      );

      const result = await session.prompt([
        { type: "text", text: "test" } as ContentBlock,
      ]);

      expect(result.content).toEqual([]);
      expect(result.stopReason).toBe("end_turn");
    });

    it("should propagate different stop reasons", async () => {
      vi.mocked(promptFn).mockResolvedValue({ stopReason: "max_tokens" });

      const session = new ACPClientSession(
        sessionId,
        promptFn,
        registerHandler,
        deregisterHandler,
      );

      const result = await session.prompt([
        { type: "text", text: "test" } as ContentBlock,
      ]);

      expect(result.stopReason).toBe("max_tokens");
    });

    it("should accumulate content blocks received during prompt execution", async () => {
      // This test simulates the real scenario where content blocks arrive
      // asynchronously during prompt execution
      let capturedHandler: ((block: ContentBlock) => void) | undefined;

      vi.mocked(registerHandler).mockImplementation((_id, handler) => {
        capturedHandler = handler;
      });

      // Simulate chunks arriving during prompt execution
      vi.mocked(promptFn).mockImplementation(async () => {
        capturedHandler?.({ type: "text", text: "chunk1 " } as ContentBlock);
        capturedHandler?.({ type: "text", text: "chunk2 " } as ContentBlock);
        capturedHandler?.({
          type: "image",
          data: "abc",
          mimeType: "image/png",
        } as ContentBlock);
        return { stopReason: "end_turn" };
      });

      const session = new ACPClientSession(
        sessionId,
        promptFn,
        registerHandler,
        deregisterHandler,
      );

      const result = await session.prompt([
        { type: "text", text: "generate content" } as ContentBlock,
      ]);

      expect(result.content).toEqual([
        { type: "text", text: "chunk1 " },
        { type: "text", text: "chunk2 " },
        { type: "image", data: "abc", mimeType: "image/png" },
      ]);
    });
  });
});
