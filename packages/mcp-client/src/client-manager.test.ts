import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MCPClientManager } from "./client-manager.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPClientSession } from "./client-session.js";
import type { ILogger } from "./types.js";
import { createWriteStream } from "fs";
import type { WriteStream } from "fs";

// Mock the SDK modules
vi.mock("@modelcontextprotocol/sdk/client/index.js");
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js");
vi.mock("@modelcontextprotocol/sdk/client/stdio.js");
vi.mock("./client-session.js");
vi.mock("fs", () => ({
  createWriteStream: vi.fn(),
}));

// Mock logger factory
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

    // Create mock SDK client
    mockSdkClient = {
      connect: vi.fn(),
      close: vi.fn(),
    } as unknown as Client;

    // Mock Client constructor
    vi.mocked(Client).mockImplementation(function (this: Client) {
      return mockSdkClient;
    } as unknown as typeof Client);

    // Create mock transport
    mockTransport = {
      connect: vi.fn(),
      close: vi.fn(),
    } as unknown as StreamableHTTPClientTransport;

    // Mock MCPClientSession
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

    it("should create and connect an HTTP client", async () => {
      const name = "test-server";
      const endpoint = "http://example.com/mcp";
      const sessionId = "session-123";

      const result = await clientManager.addHttpClient(
        name,
        endpoint,
        sessionId,
      );

      expect(result.success).toBe(true);
      expect(result.name).toBe(name);

      // Should create Client with correct config
      expect(Client).toHaveBeenCalledWith(
        {
          name: "my-cool-proxy",
          version: "1.0.0",
        },
        {
          capabilities: {},
          enforceStrictCapabilities: true,
        },
      );

      // Should connect the client
      expect(mockSdkClient.connect).toHaveBeenCalledWith(mockTransport);

      // Should wrap in MCPClientSession
      expect(MCPClientSession).toHaveBeenCalled();

      // Should log successful connection
      expect(logger.info).toHaveBeenCalledWith(
        `MCP client ${name} connected to ${endpoint}`,
      );
    });

    it("should not recreate client if it already exists for the session", async () => {
      const name = "existing-server";
      const endpoint = "http://example.com";
      const sessionId = "session-111";

      // Add client first time
      await clientManager.addHttpClient(name, endpoint, sessionId);

      // Clear mock calls
      vi.clearAllMocks();

      // Try to add same client again
      const result = await clientManager.addHttpClient(
        name,
        endpoint,
        sessionId,
      );

      expect(result.success).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        `Client ${name} already exists for session ${sessionId}`,
      );
      expect(Client).not.toHaveBeenCalled();
    });

    it("should create separate clients for different sessions", async () => {
      const name = "multi-session-server";
      const endpoint = "http://example.com";

      await clientManager.addHttpClient(name, endpoint, "session-1");
      await clientManager.addHttpClient(name, endpoint, "session-2");

      // Should create two separate clients
      expect(Client).toHaveBeenCalledTimes(2);
      expect(mockSdkClient.connect).toHaveBeenCalledTimes(2);
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

    it("should create and connect a stdio client", async () => {
      const name = "stdio-server";
      const command = "node";
      const sessionId = "session-stdio";

      const result = await clientManager.addStdioClient(
        name,
        command,
        sessionId,
      );

      expect(result.success).toBe(true);
      expect(result.name).toBe(name);

      // Should create stdio transport with stderr: inherit by default
      expect(StdioClientTransport).toHaveBeenCalledWith({
        command,
        args: undefined,
        env: undefined,
        stderr: "inherit",
      });

      // Should connect the client
      expect(mockSdkClient.connect).toHaveBeenCalledWith(mockTransport);
    });

    it("should create stdio client with args and env", async () => {
      const name = "complex-stdio";
      const command = "python";
      const sessionId = "session-complex";
      const args = ["server.py", "--port", "8080"];
      const env = { PYTHONPATH: "/custom/path" };

      await clientManager.addStdioClient(name, command, sessionId, args, env);

      // Should create transport with args and env
      expect(StdioClientTransport).toHaveBeenCalledWith({
        command,
        args,
        env,
        stderr: "inherit",
      });
    });
  });

  describe("getClient", () => {
    it("should return an existing client", async () => {
      const name = "test-server";
      const sessionId = "session-get";

      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function (
        this: StreamableHTTPClientTransport,
      ) {
        return mockTransport as StreamableHTTPClientTransport;
      } as unknown as typeof StreamableHTTPClientTransport);

      // Add a client
      await clientManager.addHttpClient(name, "http://example.com", sessionId);

      // Get the client
      const client = await clientManager.getClient(name, sessionId);

      expect(client).toBe(mockClientSession);
    });

    it("should throw error if client does not exist", async () => {
      const name = "nonexistent";
      const sessionId = "session-missing";

      await expect(clientManager.getClient(name, sessionId)).rejects.toThrow(
        `MCP client ${name} not found for session ${sessionId}`,
      );
    });
  });

  describe("getClientsBySession", () => {
    beforeEach(() => {
      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function (
        this: StreamableHTTPClientTransport,
      ) {
        return mockTransport as StreamableHTTPClientTransport;
      } as unknown as typeof StreamableHTTPClientTransport);
    });

    it("should return all clients for a specific session", async () => {
      const sessionId = "session-multi";

      // Add multiple clients for the same session
      await clientManager.addHttpClient("server1", "http://s1.com", sessionId);
      await clientManager.addHttpClient("server2", "http://s2.com", sessionId);
      await clientManager.addHttpClient("server3", "http://s3.com", sessionId);

      const clients = clientManager.getClientsBySession(sessionId);

      expect(clients.size).toBe(3);
      expect(clients.has("server1")).toBe(true);
      expect(clients.has("server2")).toBe(true);
      expect(clients.has("server3")).toBe(true);
    });

    it("should return empty map if no clients exist for session", () => {
      const clients = clientManager.getClientsBySession("nonexistent-session");

      expect(clients.size).toBe(0);
      expect(clients).toBeInstanceOf(Map);
    });
  });

  describe("connection failure handling", () => {
    it("should return failure result when HTTP connection fails", async () => {
      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function (
        this: StreamableHTTPClientTransport,
      ) {
        return mockTransport as StreamableHTTPClientTransport;
      } as unknown as typeof StreamableHTTPClientTransport);

      // Make connect fail
      vi.mocked(mockSdkClient.connect).mockRejectedValueOnce(
        new Error("Connection refused"),
      );

      const result = await clientManager.addHttpClient(
        "failing-server",
        "http://localhost:9999",
        "session-fail",
      );

      expect(result.success).toBe(false);
      expect(result.name).toBe("failing-server");
      expect(result.error).toBe("Connection refused");

      // Should log the error
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to connect MCP client failing-server"),
      );
    });

    it("should track failed servers and return them via getFailedServers", async () => {
      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function (
        this: StreamableHTTPClientTransport,
      ) {
        return mockTransport as StreamableHTTPClientTransport;
      } as unknown as typeof StreamableHTTPClientTransport);

      // Make connection fail
      vi.mocked(mockSdkClient.connect).mockRejectedValueOnce(
        new Error("Network error"),
      );

      await clientManager.addHttpClient(
        "tracked-failure",
        "http://localhost:9999",
        "session-track",
      );

      const failedServers = clientManager.getFailedServers("session-track");

      expect(failedServers.size).toBe(1);
      expect(failedServers.get("tracked-failure")).toBe("Network error");
    });
  });

  describe("closeSession", () => {
    beforeEach(() => {
      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function (
        this: StreamableHTTPClientTransport,
      ) {
        return mockTransport as StreamableHTTPClientTransport;
      } as unknown as typeof StreamableHTTPClientTransport);
    });

    it("should close all clients for a specific session", async () => {
      await clientManager.addHttpClient(
        "server1",
        "http://s1.com",
        "session-1",
      );
      await clientManager.addHttpClient(
        "server2",
        "http://s2.com",
        "session-1",
      );
      await clientManager.addHttpClient(
        "server3",
        "http://s3.com",
        "session-2",
      );

      vi.clearAllMocks();

      await clientManager.closeSession("session-1");

      // Should close 2 clients from session-1
      expect(mockClientSession.close).toHaveBeenCalledTimes(2);

      // Session-2 client should still exist
      const session2Clients = clientManager.getClientsBySession("session-2");
      expect(session2Clients.size).toBe(1);

      // Session-1 clients should be gone
      const session1Clients = clientManager.getClientsBySession("session-1");
      expect(session1Clients.size).toBe(0);
    });

    it("should handle closing non-existent session gracefully", async () => {
      await expect(
        clientManager.closeSession("nonexistent-session"),
      ).resolves.toBeUndefined();

      expect(logger.debug).toHaveBeenCalledWith(
        "Cleaned up session nonexistent-session",
      );
    });
  });

  describe("close", () => {
    beforeEach(() => {
      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function (
        this: StreamableHTTPClientTransport,
      ) {
        return mockTransport as StreamableHTTPClientTransport;
      } as unknown as typeof StreamableHTTPClientTransport);
    });

    it("should close all clients", async () => {
      // Add multiple clients
      await clientManager.addHttpClient(
        "server1",
        "http://s1.com",
        "session-1",
      );
      await clientManager.addHttpClient(
        "server2",
        "http://s2.com",
        "session-1",
      );
      await clientManager.addHttpClient(
        "server3",
        "http://s3.com",
        "session-2",
      );

      await clientManager.close();

      // Should close all clients (3 times)
      expect(mockClientSession.close).toHaveBeenCalledTimes(3);
    });

    it("should handle closing when no clients exist", async () => {
      // Should not throw
      await expect(clientManager.close()).resolves.toBeUndefined();
    });
  });

  describe("stderr logging", () => {
    let mockWriteStream: WriteStream;
    let mockStderrStream: { pipe: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      // Mock write stream
      mockWriteStream = {
        end: vi.fn(),
        write: vi.fn(),
      } as unknown as WriteStream;

      vi.mocked(createWriteStream).mockReturnValue(mockWriteStream);

      // Mock stderr stream on transport
      mockStderrStream = {
        pipe: vi.fn(),
      };

      // Create transport with stderr getter
      const transportWithStderr = {
        ...mockTransport,
        stderr: mockStderrStream,
      } as unknown as StdioClientTransport;

      vi.mocked(StdioClientTransport).mockImplementation(function (
        this: StdioClientTransport,
      ) {
        return transportWithStderr;
      } as unknown as typeof StdioClientTransport);
    });

    it("should create stdio transport with stderr: pipe when stderrLogPath is provided", async () => {
      const name = "stderr-server";
      const command = "node";
      const sessionId = "session-stderr";
      const stderrLogPath = "/tmp/test-server.log";

      await clientManager.addStdioClient(
        name,
        command,
        sessionId,
        undefined,
        undefined,
        undefined,
        undefined,
        stderrLogPath,
      );

      // Should create transport with stderr: pipe
      expect(StdioClientTransport).toHaveBeenCalledWith({
        command,
        args: undefined,
        env: undefined,
        stderr: "pipe",
      });
    });

    it("should create write stream for stderr log file", async () => {
      const stderrLogPath = "/tmp/server-stderr.log";

      await clientManager.addStdioClient(
        "log-server",
        "node",
        "session-log",
        undefined,
        undefined,
        undefined,
        undefined,
        stderrLogPath,
      );

      // Should create write stream with flags: 'w' to overwrite
      expect(createWriteStream).toHaveBeenCalledWith(stderrLogPath, {
        flags: "w",
      });
    });

    it("should pipe stderr to file stream when stderrLogPath is provided", async () => {
      const stderrLogPath = "/tmp/piped-stderr.log";

      await clientManager.addStdioClient(
        "pipe-server",
        "node",
        "session-pipe",
        undefined,
        undefined,
        undefined,
        undefined,
        stderrLogPath,
      );

      // Should pipe stderr to file stream
      expect(mockStderrStream.pipe).toHaveBeenCalledWith(mockWriteStream);
    });

    it("should log debug message about stderr redirection", async () => {
      const name = "debug-server";
      const stderrLogPath = "/tmp/debug-stderr.log";

      await clientManager.addStdioClient(
        name,
        "node",
        "session-debug",
        undefined,
        undefined,
        undefined,
        undefined,
        stderrLogPath,
      );

      expect(logger.debug).toHaveBeenCalledWith(
        `MCP client ${name} stderr redirected to ${stderrLogPath}`,
      );
    });

    it("should close stderr stream when closeSession is called", async () => {
      const sessionId = "session-close-stderr";
      const stderrLogPath = "/tmp/close-stderr.log";

      await clientManager.addStdioClient(
        "close-server",
        "node",
        sessionId,
        undefined,
        undefined,
        undefined,
        undefined,
        stderrLogPath,
      );

      await clientManager.closeSession(sessionId);

      // Should close the stderr file stream
      expect(mockWriteStream.end).toHaveBeenCalled();
    });

    it("should close all stderr streams when close is called", async () => {
      // Add multiple clients with stderr logging
      await clientManager.addStdioClient(
        "server1",
        "node",
        "session-1",
        undefined,
        undefined,
        undefined,
        undefined,
        "/tmp/server1.log",
      );

      await clientManager.addStdioClient(
        "server2",
        "node",
        "session-2",
        undefined,
        undefined,
        undefined,
        undefined,
        "/tmp/server2.log",
      );

      await clientManager.close();

      // Should close both stderr file streams
      expect(mockWriteStream.end).toHaveBeenCalledTimes(2);
    });

    it("should clean up stderr stream on connection failure", async () => {
      // Make connect fail
      vi.mocked(mockSdkClient.connect).mockRejectedValueOnce(
        new Error("Connection failed"),
      );

      const result = await clientManager.addStdioClient(
        "failing-stderr-server",
        "node",
        "session-fail-stderr",
        undefined,
        undefined,
        undefined,
        undefined,
        "/tmp/failing.log",
      );

      expect(result.success).toBe(false);
      // Should close the stderr file stream on failure
      expect(mockWriteStream.end).toHaveBeenCalled();
    });
  });
});
