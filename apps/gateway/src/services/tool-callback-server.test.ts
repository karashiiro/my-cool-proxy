import { describe, it, expect, vi } from "vitest";
import type { ILogger } from "@my-cool-proxy/logger";
import { ToolCallbackServer } from "./tool-callback-server.js";

const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
});

describe("ToolCallbackServer", () => {
  describe("start/stop lifecycle", () => {
    it("should start on an available port and return a valid callback URL", async () => {
      const server = new ToolCallbackServer(createMockLogger());

      const callbackUrl = await server.start();

      try {
        expect(callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      } finally {
        await server.stop();
      }
    });

    it("should stop cleanly without throwing when called twice", async () => {
      const server = new ToolCallbackServer(createMockLogger());

      await server.start();
      await server.stop();

      // Stopping twice should not throw - server is null now
      await server.stop();
    });
  });

  describe("tool call capture (spec-compliant)", () => {
    it("should capture tool calls and return captured response", async () => {
      const server = new ToolCallbackServer(createMockLogger());
      const callbackUrl = await server.start();

      try {
        // Initially no captured tool call
        expect(server.getCapturedToolCall()).toBeNull();

        const response = await fetch(`${callbackUrl}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "calculator-add",
            args: { a: 5, b: 3 },
          }),
        });

        expect(response.ok).toBe(true);
        const result = (await response.json()) as { status: string };
        expect(result.status).toBe("captured");

        // Tool call should be captured
        const captured = server.getCapturedToolCall();
        expect(captured).not.toBeNull();
        expect(captured!.name).toBe("calculator-add");
        expect(captured!.input).toEqual({ a: 5, b: 3 });
        // ID should be a non-empty string (UUID-like format)
        expect(typeof captured!.id).toBe("string");
        expect(captured!.id.length).toBeGreaterThan(0);
      } finally {
        await server.stop();
      }
    });

    it("should capture only the most recent tool call", async () => {
      const server = new ToolCallbackServer(createMockLogger());
      const callbackUrl = await server.start();

      try {
        // First tool call
        await fetch(`${callbackUrl}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "first-tool",
            args: { x: 1 },
          }),
        });

        // Second tool call (overwrites first)
        await fetch(`${callbackUrl}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "second-tool",
            args: { y: 2 },
          }),
        });

        // Should only have the second tool call
        const captured = server.getCapturedToolCall();
        expect(captured!.name).toBe("second-tool");
        expect(captured!.input).toEqual({ y: 2 });
      } finally {
        await server.stop();
      }
    });

    it("should generate unique IDs for captured tool calls", async () => {
      const server1 = new ToolCallbackServer(createMockLogger());
      const server2 = new ToolCallbackServer(createMockLogger());

      const callbackUrl1 = await server1.start();
      const callbackUrl2 = await server2.start();

      try {
        await fetch(`${callbackUrl1}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "tool-1",
            args: {},
          }),
        });

        await fetch(`${callbackUrl2}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "tool-2",
            args: {},
          }),
        });

        const captured1 = server1.getCapturedToolCall();
        const captured2 = server2.getCapturedToolCall();

        expect(captured1!.id).not.toBe(captured2!.id);
      } finally {
        await server1.stop();
        await server2.stop();
      }
    });

    it("should return captured response even with malformed body", async () => {
      const logger = createMockLogger();
      const server = new ToolCallbackServer(logger);
      const callbackUrl = await server.start();

      try {
        const response = await fetch(`${callbackUrl}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not valid json",
        });

        // Should still return captured to stop the flow
        expect(response.ok).toBe(true);
        const result = (await response.json()) as { status: string };
        expect(result.status).toBe("captured");

        // Error should be logged with descriptive message about the callback
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining("tool callback"),
          expect.any(Error),
        );
      } finally {
        await server.stop();
      }
    });
  });
});
