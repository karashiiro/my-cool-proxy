import { describe, it, expect, vi } from "vitest";
import type { ILogger } from "@my-cool-proxy/logger";
import { ToolCallbackServer } from "./tool-callback-server.js";

// Mock client manager and session
const createMockClientManager = (
  mockClients: Map<string, unknown> = new Map(),
) => ({
  addHttpClient: vi.fn(),
  addStdioClient: vi.fn(),
  getClient: vi.fn(),
  getClientsBySession: vi.fn().mockReturnValue(mockClients),
  getFailedServers: vi.fn().mockReturnValue(new Map()),
  closeSession: vi.fn(),
  setResourceListChangedHandler: vi.fn(),
  setPromptListChangedHandler: vi.fn(),
  setToolListChangedHandler: vi.fn(),
  close: vi.fn(),
});

const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

describe("ToolCallbackServer", () => {
  describe("start/stop lifecycle", () => {
    it("should start on an available port and return a valid callback URL", async () => {
      const clientManager = createMockClientManager();
      const server = new ToolCallbackServer(
        clientManager as never,
        "session-1",
        createMockLogger(),
      );

      const callbackUrl = await server.start();

      try {
        expect(callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      } finally {
        await server.stop();
      }
    });

    it("should stop cleanly without throwing when called twice", async () => {
      const clientManager = createMockClientManager();
      const server = new ToolCallbackServer(
        clientManager as never,
        "session-1",
        createMockLogger(),
      );

      await server.start();
      await server.stop();

      // Stopping twice should not throw - server is null now
      await server.stop();
    });
  });

  describe("tool execution routing", () => {
    it("should route tool calls to the correct MCP server", async () => {
      const mockSession = {
        listTools: vi
          .fn()
          .mockResolvedValue([
            { name: "test-tool", description: "A test tool" },
          ]),
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "Tool result!" }],
        }),
      };

      const mockClients = new Map([["test-server", mockSession]]);
      const clientManager = createMockClientManager(mockClients);
      const server = new ToolCallbackServer(
        clientManager as never,
        "session-1",
        createMockLogger(),
      );
      const callbackUrl = await server.start();

      try {
        const response = await fetch(`${callbackUrl}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "test-tool",
            args: { input: "hello" },
          }),
        });

        expect(response.ok).toBe(true);
        const result = await response.json();
        expect(result).toEqual({
          content: [{ type: "text", text: "Tool result!" }],
        });
        expect(mockSession.callTool).toHaveBeenCalledWith({
          name: "test-tool",
          arguments: { input: "hello" },
        });
      } finally {
        await server.stop();
      }
    });

    it("should return 404 when tool is not found", async () => {
      const mockSession = {
        listTools: vi.fn().mockResolvedValue([]),
        callTool: vi.fn(),
      };

      const mockClients = new Map([["test-server", mockSession]]);
      const clientManager = createMockClientManager(mockClients);
      const server = new ToolCallbackServer(
        clientManager as never,
        "session-1",
        createMockLogger(),
      );
      const callbackUrl = await server.start();

      try {
        const response = await fetch(`${callbackUrl}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "nonexistent-tool",
            args: {},
          }),
        });

        expect(response.status).toBe(404);
        const result = (await response.json()) as {
          isError: boolean;
          content: { text: string }[];
        };
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain("not found");
      } finally {
        await server.stop();
      }
    });

    it("should continue to next server when one fails", async () => {
      const failingSession = {
        listTools: vi.fn().mockRejectedValue(new Error("Connection failed")),
        callTool: vi.fn(),
      };
      const workingSession = {
        listTools: vi
          .fn()
          .mockResolvedValue([
            { name: "tool-on-second-server", description: "Test" },
          ]),
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "Success from second server" }],
        }),
      };

      const mockClients = new Map([
        ["failing-server", failingSession],
        ["working-server", workingSession],
      ]);
      const clientManager = createMockClientManager(mockClients);
      const server = new ToolCallbackServer(
        clientManager as never,
        "session-1",
        createMockLogger(),
      );
      const callbackUrl = await server.start();

      try {
        const response = await fetch(`${callbackUrl}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "tool-on-second-server",
            args: {},
          }),
        });

        expect(response.ok).toBe(true);
        const result = (await response.json()) as {
          content: { text: string }[];
        };
        expect(result.content[0]?.text).toBe("Success from second server");
      } finally {
        await server.stop();
      }
    });
  });
});
