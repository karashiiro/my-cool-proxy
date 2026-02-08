import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MCPClientManager } from "./client-manager.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPClientSession } from "./client-session.js";
import type { ILogger, ClientCapabilities } from "./types.js";
import { createWriteStream } from "fs";
import type { WriteStream } from "fs";

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
});
