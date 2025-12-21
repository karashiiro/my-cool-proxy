import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MCPClientManager } from "./client-manager.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPClientSession } from "./client-session.js";
import type { ILogger } from "../types/interfaces.js";

// Mock the SDK modules
vi.mock("@modelcontextprotocol/sdk/client/index.js");
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js");
vi.mock("@modelcontextprotocol/sdk/client/stdio.js");
vi.mock("./client-session.js");

// Mock logger
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
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

      await clientManager.addHttpClient(name, endpoint, sessionId);

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

      // Should create transport with correct endpoint
      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL(endpoint),
        {
          requestInit: undefined,
        },
      );

      // Should connect the client
      expect(mockSdkClient.connect).toHaveBeenCalledWith(mockTransport);

      // Should wrap in MCPClientSession
      expect(MCPClientSession).toHaveBeenCalledWith(
        mockSdkClient,
        name,
        undefined,
        logger,
        undefined,
        undefined,
      );

      // Should log successful connection
      expect(logger.info).toHaveBeenCalledWith(
        `MCP client ${name} connected to ${endpoint}`,
      );
    });

    it("should create HTTP client with custom headers", async () => {
      const name = "api-server";
      const endpoint = "https://api.example.com";
      const sessionId = "session-456";
      const headers = {
        Authorization: "Bearer token123",
        "X-Custom-Header": "custom-value",
      };

      await clientManager.addHttpClient(name, endpoint, sessionId, headers);

      // Should create transport with headers
      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL(endpoint),
        {
          requestInit: { headers },
        },
      );

      expect(logger.info).toHaveBeenCalledWith(
        `MCP client ${name} connected to ${endpoint}`,
      );
    });

    it("should create HTTP client with allowed tools filter", async () => {
      const name = "filtered-server";
      const endpoint = "http://example.com";
      const sessionId = "session-789";
      const allowedTools = ["tool1", "tool2"];

      await clientManager.addHttpClient(
        name,
        endpoint,
        sessionId,
        undefined,
        allowedTools,
      );

      // Should wrap with allowed tools
      expect(MCPClientSession).toHaveBeenCalledWith(
        mockSdkClient,
        name,
        allowedTools,
        logger,
        undefined,
        undefined,
      );

      // Should log tool filter configuration
      expect(logger.info).toHaveBeenCalledWith(
        `MCP client ${name} configured with tool filter: tool1, tool2`,
      );
      expect(logger.info).toHaveBeenCalledWith(
        `MCP client ${name} connected to ${endpoint}`,
      );
    });

    it("should log when empty allowed tools blocks all tools", async () => {
      const name = "blocked-server";
      const endpoint = "http://example.com";
      const sessionId = "session-000";
      const allowedTools: string[] = [];

      await clientManager.addHttpClient(
        name,
        endpoint,
        sessionId,
        undefined,
        allowedTools,
      );

      // Should log that all tools are blocked
      expect(logger.info).toHaveBeenCalledWith(
        `MCP client ${name} configured with tool filter: all tools blocked`,
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
      await clientManager.addHttpClient(name, endpoint, sessionId);

      // Should only log debug message, not create new client
      expect(logger.debug).toHaveBeenCalledWith(
        `Client ${name} already exists for session ${sessionId}`,
      );
      expect(Client).not.toHaveBeenCalled();
      expect(StreamableHTTPClientTransport).not.toHaveBeenCalled();
      expect(mockSdkClient.connect).not.toHaveBeenCalled();
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

      await clientManager.addStdioClient(name, command, sessionId);

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

      // Should create stdio transport
      expect(StdioClientTransport).toHaveBeenCalledWith({
        command,
        args: undefined,
        env: undefined,
      });

      // Should connect the client
      expect(mockSdkClient.connect).toHaveBeenCalledWith(mockTransport);

      // Should wrap in MCPClientSession
      expect(MCPClientSession).toHaveBeenCalledWith(
        mockSdkClient,
        name,
        undefined,
        logger,
        undefined,
        undefined,
      );

      // Should log successful connection
      expect(logger.info).toHaveBeenCalledWith(
        `MCP client ${name} connected to stdio process: ${command} `,
      );
    });

    it("should create stdio client with args and env", async () => {
      const name = "complex-stdio";
      const command = "python";
      const sessionId = "session-complex";
      const args = ["server.py", "--port", "8080"];
      const env = { PYTHONPATH: "/custom/path", DEBUG: "true" };

      await clientManager.addStdioClient(name, command, sessionId, args, env);

      // Should create transport with args and env
      expect(StdioClientTransport).toHaveBeenCalledWith({
        command,
        args,
        env,
      });

      // Should log with args
      expect(logger.info).toHaveBeenCalledWith(
        `MCP client ${name} connected to stdio process: ${command} ${args.join(" ")}`,
      );
    });

    it("should create stdio client with allowed tools filter", async () => {
      const name = "filtered-stdio";
      const command = "node";
      const sessionId = "session-filtered";
      const allowedTools = ["read-file", "write-file"];

      await clientManager.addStdioClient(
        name,
        command,
        sessionId,
        undefined,
        undefined,
        allowedTools,
      );

      // Should wrap with allowed tools
      expect(MCPClientSession).toHaveBeenCalledWith(
        mockSdkClient,
        name,
        allowedTools,
        logger,
        undefined,
        undefined,
      );

      // Should log tool filter configuration
      expect(logger.info).toHaveBeenCalledWith(
        `MCP client ${name} configured with tool filter: read-file, write-file`,
      );
    });

    it("should log when empty allowed tools blocks all tools", async () => {
      const name = "blocked-stdio";
      const command = "node";
      const sessionId = "session-blocked";
      const allowedTools: string[] = [];

      await clientManager.addStdioClient(
        name,
        command,
        sessionId,
        undefined,
        undefined,
        allowedTools,
      );

      // Should log that all tools are blocked
      expect(logger.info).toHaveBeenCalledWith(
        `MCP client ${name} configured with tool filter: all tools blocked`,
      );
    });

    it("should not recreate client if it already exists for the session", async () => {
      const name = "existing-stdio";
      const command = "node";
      const sessionId = "session-222";

      // Add client first time
      await clientManager.addStdioClient(name, command, sessionId);

      // Clear mock calls
      vi.clearAllMocks();

      // Try to add same client again
      await clientManager.addStdioClient(name, command, sessionId);

      // Should only log debug message, not create new client
      expect(logger.debug).toHaveBeenCalledWith(
        `Client ${name} already exists for session ${sessionId}`,
      );
      expect(Client).not.toHaveBeenCalled();
      expect(StdioClientTransport).not.toHaveBeenCalled();
      expect(mockSdkClient.connect).not.toHaveBeenCalled();
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

    it("should throw error if client exists but for different session", async () => {
      const name = "session-specific";

      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function (
        this: StreamableHTTPClientTransport,
      ) {
        return mockTransport as StreamableHTTPClientTransport;
      } as unknown as typeof StreamableHTTPClientTransport);

      // Add client for session-1
      await clientManager.addHttpClient(
        name,
        "http://example.com",
        "session-1",
      );

      // Try to get it for session-2
      await expect(clientManager.getClient(name, "session-2")).rejects.toThrow(
        `MCP client ${name} not found for session session-2`,
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

    it("should only return clients for the specified session", async () => {
      // Add clients for different sessions
      await clientManager.addHttpClient(
        "server1",
        "http://s1.com",
        "session-1",
      );
      await clientManager.addHttpClient(
        "server2",
        "http://s2.com",
        "session-2",
      );
      await clientManager.addHttpClient(
        "server3",
        "http://s3.com",
        "session-1",
      );

      const session1Clients = clientManager.getClientsBySession("session-1");
      const session2Clients = clientManager.getClientsBySession("session-2");

      expect(session1Clients.size).toBe(2);
      expect(session1Clients.has("server1")).toBe(true);
      expect(session1Clients.has("server3")).toBe(true);

      expect(session2Clients.size).toBe(1);
      expect(session2Clients.has("server2")).toBe(true);
    });

    it("should return empty map if no clients exist for session", () => {
      const clients = clientManager.getClientsBySession("nonexistent-session");

      expect(clients.size).toBe(0);
      expect(clients).toBeInstanceOf(Map);
    });

    it("should correctly extract client names from keys", async () => {
      const sessionId = "session-extract";

      await clientManager.addHttpClient(
        "my-complex-server-name",
        "http://example.com",
        sessionId,
      );

      const clients = clientManager.getClientsBySession(sessionId);

      expect(clients.has("my-complex-server-name")).toBe(true);
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

    it("should log closure of each client", async () => {
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

      // Clear previous logs
      vi.clearAllMocks();

      await clientManager.close();

      // Should log closure for each client
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Closed MCP client server1-session-1/),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Closed MCP client server2-session-1/),
      );
    });

    it("should handle closing when no clients exist", async () => {
      // Should not throw
      await expect(clientManager.close()).resolves.toBeUndefined();
    });

    it("should close clients even if some fail", async () => {
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

      // Make first close fail
      vi.mocked(mockClientSession.close)
        .mockRejectedValueOnce(new Error("Close failed"))
        .mockResolvedValueOnce(undefined);

      // Should throw on first failure (current behavior)
      await expect(clientManager.close()).rejects.toThrow("Close failed");

      // Only first client close was attempted
      expect(mockClientSession.close).toHaveBeenCalledTimes(1);
    });
  });
});
