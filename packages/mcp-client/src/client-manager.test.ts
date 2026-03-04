import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MCPClientManager } from "./client-manager.js";
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
      const res = await clientManager.addHttpClient("name", "http://x", "s");
      expect(res.success).toBe(true);
      expect(mockSdkClient.connect).toHaveBeenCalledWith(mockTransport);
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
      const res = await clientManager.addStdioClient("n", "node", "s");
      expect(res.success).toBe(true);
      expect(mockSdkClient.connect).toHaveBeenCalledWith(mockTransport);
    });

    it("passes cwd to StdioClientTransport when provided", async () => {
      await clientManager.addStdioClient(
        "cwd-test",
        "node",
        "sess-cwd",
        ["server.js"],
        undefined,
        undefined,
        undefined,
        undefined, // stderrLogPath
        undefined, // dangerouslyEnableSampling
        "/home/user/project", // cwd
      );
      expect(StdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "node",
          args: ["server.js"],
          cwd: "/home/user/project",
        }),
      );
    });

    it("does not include cwd in StdioClientTransport options when not provided", async () => {
      await clientManager.addStdioClient("no-cwd", "node", "sess-no-cwd");
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

      await clientManager.addHttpClient("s1", "http://x", "session-a");
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
      await clientManager.addStdioClient(
        "name",
        "node",
        "sess",
        undefined,
        undefined,
        undefined,
        undefined,
        path,
      );
      expect(createWriteStream).toHaveBeenCalledWith(path, { flags: "w" });
      expect(mockStderrStream.pipe).toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalled();
    });

    it("closes stderr stream on session close", async () => {
      const path = "/tmp/log2.txt";
      await clientManager.addStdioClient(
        "name2",
        "node",
        "sess2",
        undefined,
        undefined,
        undefined,
        undefined,
        path,
      );
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
      await clientManager.addHttpClient(
        "caps",
        "http://x",
        "sess-caps",
        undefined,
        undefined,
        caps,
        true, // dangerouslyEnableSampling
      );
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
      await clientManager.addStdioClient(
        "stdio-caps",
        "node",
        "sess-s",
        ["server.js"],
        undefined,
        undefined,
        caps,
        undefined, // stderrLogPath
        true, // dangerouslyEnableSampling
      );
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
      await clientManager.addHttpClient(
        "untrusted",
        "http://x",
        "sess-untrusted",
        undefined,
        undefined,
        caps,
        false, // dangerouslyEnableSampling
      );
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
      await clientManager.addHttpClient(
        "default-deny",
        "http://x",
        "sess-default",
        undefined,
        undefined,
        caps,
        undefined, // dangerouslyEnableSampling (default-deny)
      );
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
      await clientManager.addHttpClient(
        "no-client-sampling",
        "http://x",
        "sess-no-sampling",
        undefined,
        undefined,
        capsWithoutSampling,
        true, // dangerouslyEnableSampling (but client lacks sampling)
      );
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
      await clientManager.addHttpClient(
        "filtered",
        "http://x",
        "s",
        undefined,
        ["t1", "t2"],
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("configured with tool filter"),
      );
    });

    it("logs when all tools blocked for HTTP client", async () => {
      await clientManager.addHttpClient(
        "blocked",
        "http://x",
        "s2",
        undefined,
        [],
      );
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

      await clientManager.addHttpClient("log-test", "http://x", "sess-log");

      // Get the logging callback that was passed to MCPClientSession
      const sessionCalls = vi.mocked(MCPClientSession).mock.calls;
      const lastCall = sessionCalls[sessionCalls.length - 1];
      // onLoggingMessage is the 9th argument (index 8)
      const loggingCallback = lastCall?.[8] as
        | ((params: { level: string; data: unknown }) => void)
        | undefined;

      expect(loggingCallback).toBeDefined();

      // Simulate calling the callback
      loggingCallback!({ level: "info", data: "test message" });

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

      await clientManager.addStdioClient("stdio-log", "node", "sess-stdio-log");

      // Verify MCPClientSession was called with logging callback for stdio client
      const sessionCalls = vi.mocked(MCPClientSession).mock.calls;
      const lastCall = sessionCalls[sessionCalls.length - 1];
      const loggingCallback = lastCall?.[8];

      expect(loggingCallback).toBeDefined();
    });

    it("does not pass logging callback when handler not set", async () => {
      // Don't set any logging handler

      await clientManager.addHttpClient("no-log", "http://x", "sess-no-log");

      // Verify MCPClientSession was called with undefined for logging callback
      const sessionCalls = vi.mocked(MCPClientSession).mock.calls;
      const lastCall = sessionCalls[sessionCalls.length - 1];
      const loggingCallback = lastCall?.[8];

      expect(loggingCallback).toBeUndefined();
    });
  });
});
