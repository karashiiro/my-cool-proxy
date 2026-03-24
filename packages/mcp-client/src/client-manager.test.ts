import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MCPClientManager,
  CLIENT_CONNECT_TIMEOUT_MS,
} from "./client-manager.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPClientSession } from "./client-session.js";
import type { ILogger, ClientCapabilities } from "./types.js";
import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";

// Mock the SDK modules and fs
vi.mock("@modelcontextprotocol/sdk/client/index.js");
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js");
vi.mock("@modelcontextprotocol/sdk/client/stdio.js");
vi.mock("./client-session.js");
vi.mock("fs", () => ({ createWriteStream: vi.fn() }));

const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
});

describe("MCPClientManager", () => {
  let clientManager: MCPClientManager;
  let logger: ILogger;
  let mockSdkClient: Client;
  let mockTransport: StreamableHTTPClientTransport | StdioClientTransport;
  let mockClientSession: MCPClientSession;

  beforeEach(() => {
    logger = createMockLogger();
    clientManager = new MCPClientManager(logger);

    mockSdkClient = { connect: vi.fn(), close: vi.fn() } as unknown as Client;
    vi.mocked(Client).mockImplementation(function (this: Client) {
      return mockSdkClient;
    } as unknown as typeof Client);

    mockTransport = {
      connect: vi.fn(),
      close: vi.fn(),
    } as unknown as StreamableHTTPClientTransport;

    mockClientSession = {
      listTools: vi.fn(),
      close: vi.fn(),
    } as unknown as MCPClientSession;
    vi.mocked(MCPClientSession).mockImplementation(function (
      this: MCPClientSession,
    ) {
      return mockClientSession;
    } as unknown as typeof MCPClientSession);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("addHttpClient", () => {
    beforeEach(() => {
      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function (
        this: StreamableHTTPClientTransport,
      ) {
        return mockTransport as StreamableHTTPClientTransport;
      } as unknown as typeof StreamableHTTPClientTransport);
    });

    it("creates and connects HTTP client", async () => {
      const res = await clientManager.addHttpClient({
        name: "name",
        endpoint: "http://x",
        sessionId: "s",
      });
      expect(res.success).toBe(true);
      expect(mockSdkClient.connect).toHaveBeenCalledWith(mockTransport);
    });

    it("times out when upstream does not respond within CLIENT_CONNECT_TIMEOUT_MS", async () => {
      vi.useFakeTimers();
      try {
        // Create a promise that never resolves
        const neverResolvingPromise = new Promise<void>(() => {});
        mockSdkClient.connect = vi.fn(() => neverResolvingPromise);

        // Call addHttpClient (will hang without timeout)
        const resultPromise = clientManager.addHttpClient(
          "hanging-server",
          "http://slow-server.test",
          "session-timeout",
        );

        // Advance timers by the timeout duration (30 seconds)
        await vi.advanceTimersByTimeAsync(CLIENT_CONNECT_TIMEOUT_MS);

        const res = await resultPromise;

        expect(res.success).toBe(false);
        expect(res.error).toContain("timed out");
      } finally {
        vi.useRealTimers();
      }
    });

    it("records timed-out server in failedServers", async () => {
      vi.useFakeTimers();
      try {
        // Create a promise that never resolves
        const neverResolvingPromise = new Promise<void>(() => {});
        mockSdkClient.connect = vi.fn(() => neverResolvingPromise);

        // Call addHttpClient
        const resultPromise = clientManager.addHttpClient(
          "slow-server",
          "http://slow.test",
          "session-slow",
        );

        // Advance timers by the timeout duration
        await vi.advanceTimersByTimeAsync(CLIENT_CONNECT_TIMEOUT_MS);

        await resultPromise;

        // Check failedServers contains the timed-out server
        const failedServers = clientManager.getFailedServers("session-slow");
        expect(failedServers.has("slow-server")).toBe(true);
        expect(failedServers.get("slow-server")).toContain("timed out");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("addStdioClient", () => {
    beforeEach(() => {
      vi.mocked(StdioClientTransport).mockImplementation(function (
        this: StdioClientTransport,
      ) {
        return mockTransport as StdioClientTransport;
      } as unknown as typeof StdioClientTransport);
    });

    it("creates and connects stdio client", async () => {
      const res = await clientManager.addStdioClient({
        name: "n",
        command: "node",
        sessionId: "s",
      });
      expect(res.success).toBe(true);
      expect(mockSdkClient.connect).toHaveBeenCalledWith(mockTransport);
    });

    it("passes cwd to StdioClientTransport when provided", async () => {
      await clientManager.addStdioClient({
        name: "cwd-test",
        command: "node",
        sessionId: "sess-cwd",
        args: ["server.js"],
        cwd: "/home/user/project",
      });
      expect(StdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "node",
          args: ["server.js"],
          cwd: "/home/user/project",
        }),
      );
    });

    it("does not include cwd in StdioClientTransport options when not provided", async () => {
      await clientManager.addStdioClient({
        name: "no-cwd",
        command: "node",
        sessionId: "sess-no-cwd",
      });
      expect(StdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "node",
          cwd: undefined,
        }),
      );
    });
  });

  describe("getClient / getClientsBySession", () => {
    it("returns client when present", async () => {
      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function (
        this: StreamableHTTPClientTransport,
      ) {
        return mockTransport as StreamableHTTPClientTransport;
      } as unknown as typeof StreamableHTTPClientTransport);

      await clientManager.addHttpClient({
        name: "s1",
        endpoint: "http://x",
        sessionId: "session-a",
      });
      const c = await clientManager.getClient("s1", "session-a");
      expect(c).toBe(mockClientSession);
    });
  });

  describe("stderr logging", () => {
    let mockWriteStream: WriteStream;
    let mockStderrStream: { pipe: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockWriteStream = {
        end: vi.fn(),
        write: vi.fn(),
      } as unknown as WriteStream;
      vi.mocked(createWriteStream).mockReturnValue(mockWriteStream);

      mockStderrStream = { pipe: vi.fn() };
      const transportWithStderr = {
        ...(mockTransport as object),
        stderr: mockStderrStream,
      } as unknown as StdioClientTransport;
      vi.mocked(StdioClientTransport).mockImplementation(function (
        this: StdioClientTransport,
      ) {
        return transportWithStderr;
      } as unknown as typeof StdioClientTransport);
    });

    it("pipes stderr to file when stderrLogPath provided", async () => {
      const path = "/tmp/log.txt";
      await clientManager.addStdioClient({
        name: "name",
        command: "node",
        sessionId: "sess",
        stderrLogPath: path,
      });
      expect(createWriteStream).toHaveBeenCalledWith(path, { flags: "w" });
      expect(mockStderrStream.pipe).toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalled();
    });

    it("closes stderr stream on session close", async () => {
      const path = "/tmp/log2.txt";
      await clientManager.addStdioClient({
        name: "name2",
        command: "node",
        sessionId: "sess2",
        stderrLogPath: path,
      });
      await clientManager.closeSession("sess2");
      expect(mockWriteStream.end).toHaveBeenCalled();
    });
  });

  describe("client capabilities forwarding", () => {
    beforeEach(() => {
      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function (
        this: StreamableHTTPClientTransport,
      ) {
        return mockTransport as StreamableHTTPClientTransport;
      } as unknown as typeof StreamableHTTPClientTransport);
    });

    it("forwards sampling capability", async () => {
      const caps: ClientCapabilities = {
        sampling: { context: {}, tools: {} },
      };
      await clientManager.addHttpClient({
        name: "caps",
        endpoint: "http://x",
        sessionId: "sess-caps",
        clientCapabilities: caps,
        dangerouslyEnableSampling: true,
      });
      expect(Client).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          capabilities: expect.objectContaining({
            sampling: expect.any(Object),
          }),
        }),
      );
      expect(logger.debug).toHaveBeenCalled();
    });

    it("forwards capabilities for stdio client", async () => {
      const caps: ClientCapabilities = { sampling: { tools: {} } };
      await clientManager.addStdioClient({
        name: "stdio-caps",
        command: "node",
        sessionId: "sess-s",
        args: ["server.js"],
        clientCapabilities: caps,
        dangerouslyEnableSampling: true,
      });
      expect(Client).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          capabilities: expect.objectContaining({
            sampling: expect.any(Object),
          }),
        }),
      );
    });

    it("does NOT forward sampling when dangerouslyEnableSampling=false", async () => {
      const caps: ClientCapabilities = {
        sampling: { context: {}, tools: {} },
      };
      await clientManager.addHttpClient({
        name: "untrusted",
        endpoint: "http://x",
        sessionId: "sess-untrusted",
        clientCapabilities: caps,
        dangerouslyEnableSampling: false,
      });
      expect(Client).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          capabilities: {}, // sampling NOT included
        }),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("NOT advertised"),
      );
    });

    it("does NOT forward sampling when dangerouslyEnableSampling=undefined", async () => {
      const caps: ClientCapabilities = { sampling: { tools: {} } };
      await clientManager.addHttpClient({
        name: "default-deny",
        endpoint: "http://x",
        sessionId: "sess-default",
        clientCapabilities: caps,
      });
      expect(Client).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          capabilities: {}, // sampling NOT included
        }),
      );
    });

    it("does NOT forward sampling when client lacks it even with dangerouslyEnableSampling=true", async () => {
      const capsWithoutSampling: ClientCapabilities = {
        elicitation: { form: {} },
      };
      await clientManager.addHttpClient({
        name: "no-client-sampling",
        endpoint: "http://x",
        sessionId: "sess-no-sampling",
        clientCapabilities: capsWithoutSampling,
        dangerouslyEnableSampling: true,
      });
      expect(Client).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          capabilities: expect.objectContaining({
            elicitation: expect.any(Object),
          }),
        }),
      );
      // sampling should NOT be in capabilities
      const lastCall =
        vi.mocked(Client).mock.calls[vi.mocked(Client).mock.calls.length - 1];
      const clientCaps = lastCall?.[1]?.capabilities as
        | Record<string, unknown>
        | undefined;
      expect(clientCaps?.sampling).toBeUndefined();
    });
  });

  describe("allowedTools configuration", () => {
    beforeEach(() => {
      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function (
        this: StreamableHTTPClientTransport,
      ) {
        return mockTransport as StreamableHTTPClientTransport;
      } as unknown as typeof StreamableHTTPClientTransport);

      vi.mocked(StdioClientTransport).mockImplementation(function (
        this: StdioClientTransport,
      ) {
        return mockTransport as StdioClientTransport;
      } as unknown as typeof StdioClientTransport);
    });

    it("logs when allowedTools configured for HTTP client", async () => {
      await clientManager.addHttpClient({
        name: "filtered",
        endpoint: "http://x",
        sessionId: "s",
        allowedTools: ["t1", "t2"],
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("configured with tool filter"),
      );
    });

    it("logs when all tools blocked for HTTP client", async () => {
      await clientManager.addHttpClient({
        name: "blocked",
        endpoint: "http://x",
        sessionId: "s2",
        allowedTools: [],
      });
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("logging message handler", () => {
    beforeEach(() => {
      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function (
        this: StreamableHTTPClientTransport,
      ) {
        return mockTransport as StreamableHTTPClientTransport;
      } as unknown as typeof StreamableHTTPClientTransport);
    });

    it("stores and invokes logging handler with sessionId", async () => {
      const loggingHandler = vi.fn();
      clientManager.setLoggingMessageHandler(loggingHandler);

      await clientManager.addHttpClient({
        name: "log-test",
        endpoint: "http://x",
        sessionId: "sess-log",
      });

      // Get the logging callback that was passed to MCPClientSession
      const sessionCalls = vi.mocked(MCPClientSession).mock.calls;
      const lastCall = sessionCalls[sessionCalls.length - 1];
      // onLoggingMessage is the 9th argument (index 8)
      const loggingCallback = lastCall?.[8] as
        | ((params: { level: string; data: unknown }) => void)
        | undefined;

      expect(loggingCallback).toBeDefined();
      if (!loggingCallback)
        throw new Error("Expected loggingCallback to be defined");

      // Simulate calling the callback
      loggingCallback({ level: "info", data: "test message" });

      // Verify the handler was called with params AND sessionId
      expect(loggingHandler).toHaveBeenCalledWith(
        { level: "info", data: "test message" },
        "sess-log",
      );
    });

    it("passes logging callback to stdio client", async () => {
      vi.mocked(StdioClientTransport).mockImplementation(function (
        this: StdioClientTransport,
      ) {
        return mockTransport as StdioClientTransport;
      } as unknown as typeof StdioClientTransport);

      const loggingHandler = vi.fn();
      clientManager.setLoggingMessageHandler(loggingHandler);

      await clientManager.addStdioClient({
        name: "stdio-log",
        command: "node",
        sessionId: "sess-stdio-log",
      });

      // Verify MCPClientSession was called with logging callback for stdio client
      const sessionCalls = vi.mocked(MCPClientSession).mock.calls;
      const lastCall = sessionCalls[sessionCalls.length - 1];
      const loggingCallback = lastCall?.[8];

      expect(loggingCallback).toBeDefined();
    });

    it("does not pass logging callback when handler not set", async () => {
      // Don't set any logging handler

      await clientManager.addHttpClient({
        name: "no-log",
        endpoint: "http://x",
        sessionId: "sess-no-log",
      });

      // Verify MCPClientSession was called with undefined for logging callback
      const sessionCalls = vi.mocked(MCPClientSession).mock.calls;
      const lastCall = sessionCalls[sessionCalls.length - 1];
      const loggingCallback = lastCall?.[8];

      expect(loggingCallback).toBeUndefined();
    });
  });
});
