import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import {
  ACPClient,
  type ILogger,
  type AllowOwnToolsConfig,
} from "@my-cool-proxy/acp-client";
import type * as acp from "@agentclientprotocol/sdk";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Variable to capture the handler passed to ClientSideConnection
let capturedHandler: acp.Client | null = null;

// Mock @agentclientprotocol/sdk
vi.mock("@agentclientprotocol/sdk", () => ({
  ndJsonStream: vi.fn().mockReturnValue({ readable: {}, writable: {} }),
  ClientSideConnection: vi.fn(),
  PROTOCOL_VERSION: "2025-01-01",
}));

// Mock stream conversions
vi.mock("stream", () => ({
  Readable: {
    toWeb: vi.fn().mockReturnValue({}),
  },
  Writable: {
    toWeb: vi.fn().mockReturnValue({}),
  },
}));

const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
});

describe("ACPClient", () => {
  let mockProcess: Partial<ChildProcess>;
  let mockConnection: {
    initialize: ReturnType<typeof vi.fn>;
    newSession: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedHandler = null;

    // Set up mock process
    const mockOnce = vi.fn((event: string, callback: () => void) => {
      // Immediately call exit callback to simulate process exiting
      if (event === "exit") {
        setImmediate(callback);
      }
    });

    mockProcess = {
      stdin: { write: vi.fn() } as unknown as ChildProcess["stdin"],
      stdout: { read: vi.fn() } as unknown as ChildProcess["stdout"],
      kill: vi.fn(),
      on: vi.fn(),
      once: mockOnce as unknown as ChildProcess["once"],
    };

    // Set up mock connection
    mockConnection = {
      initialize: vi.fn().mockResolvedValue({
        protocolVersion: "2025-01-01",
        agentCapabilities: {},
      }),
      newSession: vi.fn().mockResolvedValue({
        sessionId: "acp-session-123",
      }),
      prompt: vi.fn().mockResolvedValue({
        stopReason: "end_turn",
      }),
    };

    // Configure spawn mock
    const { spawn } = await import("node:child_process");
    vi.mocked(spawn).mockReturnValue(mockProcess as ChildProcess);

    // Configure ClientSideConnection mock - capture the handler for permission testing
    const acpSdk = await import("@agentclientprotocol/sdk");
    vi.mocked(acpSdk.ClientSideConnection).mockImplementation(
      function (getClient) {
        // The getClient function receives an Agent instance, but we can pass a mock
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        capturedHandler = getClient(mockConnection as any);
        return mockConnection as unknown as InstanceType<
          typeof acpSdk.ClientSideConnection
        >;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("connect", () => {
    it("should spawn process with correct command and args", async () => {
      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger: createMockLogger(),
      });

      await client.connect();

      expect(spawn).toHaveBeenCalledWith("node", ["agent.js"], {
        stdio: ["pipe", "pipe", "inherit"],
        env: undefined,
        shell: true,
      });
    });

    it("should pass environment variables to spawned process", async () => {
      const client = new ACPClient({
        config: {
          command: "node",
          args: ["agent.js"],
          env: { MODEL: "gpt-4" },
        },
        logger: createMockLogger(),
      });

      await client.connect();

      expect(spawn).toHaveBeenCalledWith("node", ["agent.js"], {
        stdio: ["pipe", "pipe", "inherit"],
        env: expect.objectContaining({ MODEL: "gpt-4" }),
        shell: true,
      });
    });

    it("should initialize the ACP connection with protocol version", async () => {
      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger: createMockLogger(),
      });

      await client.connect();

      expect(mockConnection.initialize).toHaveBeenCalledWith({
        protocolVersion: "2025-01-01",
        clientCapabilities: {},
      });
    });

    it("should throw if process stdio is not available", async () => {
      // Mock process without stdin/stdout
      vi.mocked(spawn).mockReturnValue({
        stdin: null,
        stdout: null,
        kill: vi.fn(),
        on: vi.fn(),
      } as unknown as ChildProcess);

      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger: createMockLogger(),
      });

      await expect(client.connect()).rejects.toThrow(
        /Failed to create stdio streams/,
      );
    });

    it("should use default empty args when none provided", async () => {
      const client = new ACPClient({
        config: { command: "my-agent" },
        logger: createMockLogger(),
      });

      await client.connect();

      expect(spawn).toHaveBeenCalledWith("my-agent", [], expect.any(Object));
    });

    it("should capture prompt capabilities from initialize response", async () => {
      mockConnection.initialize.mockResolvedValue({
        protocolVersion: "2025-01-01",
        agentCapabilities: {
          promptCapabilities: { image: true, audio: true },
        },
      });

      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger: createMockLogger(),
      });

      await client.connect();

      expect(client.promptCapabilities).toEqual({
        image: true,
        audio: true,
      });
    });

    it("should default to empty capabilities when agent omits them", async () => {
      mockConnection.initialize.mockResolvedValue({
        protocolVersion: "2025-01-01",
        // No agentCapabilities at all
      });

      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger: createMockLogger(),
      });

      await client.connect();

      expect(client.promptCapabilities).toEqual({});
    });
  });

  describe("createSession", () => {
    it("should create a new ACP session via the connection", async () => {
      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger: createMockLogger(),
      });

      await client.connect();
      const session = await client.createSession();

      expect(mockConnection.newSession).toHaveBeenCalledWith({
        cwd: expect.any(String),
        mcpServers: [],
      });
      expect(session).toBeDefined();
    });

    it("should throw if not connected", async () => {
      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger: createMockLogger(),
      });

      await expect(client.createSession()).rejects.toThrow(/not connected/);
    });

    it("should return an ACPClientSession that can prompt", async () => {
      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger: createMockLogger(),
      });

      await client.connect();
      const session = await client.createSession();

      const content = [{ type: "text" as const, text: "Hello" }];
      const result = await session.prompt(content);

      expect(mockConnection.prompt).toHaveBeenCalledWith({
        sessionId: "acp-session-123",
        prompt: content,
      });
      expect(result.stopReason).toBe("end_turn");
      expect(result.content).toEqual([]);
    });
  });

  describe("close", () => {
    it("should kill the spawned process", async () => {
      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger: createMockLogger(),
      });

      await client.connect();
      await client.close();

      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it("should be safe to call when not connected", async () => {
      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger: createMockLogger(),
      });

      // Should not throw
      await client.close();
    });

    it("should prevent createSession after close", async () => {
      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger: createMockLogger(),
      });

      await client.connect();
      await client.close();

      await expect(client.createSession()).rejects.toThrow(/not connected/);
    });
  });

  describe("permission handling (allowOwnTools)", () => {
    // Helper to create a permission request with proper ACP SDK types
    const createPermissionRequest = (
      title: string,
      kind?: string,
    ): acp.RequestPermissionRequest => ({
      sessionId: "test-session",
      toolCall: {
        toolCallId: "test-tool-call-id",
        title,
        kind: kind as acp.ToolKind | undefined,
      },
      options: [
        { optionId: "allow-once", name: "Allow Once", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ],
    });

    it("should approve all permissions when dangerouslyAllowAll is true", async () => {
      const logger = createMockLogger();
      const allowOwnTools: AllowOwnToolsConfig = {
        dangerouslyAllowAll: true,
      };

      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger,
        allowOwnTools,
      });

      await client.connect();

      // Handler should be captured
      expect(capturedHandler).not.toBeNull();

      // Test permission request for an "execute" kind tool (normally dangerous)
      const result = await capturedHandler!.requestPermission(
        createPermissionRequest("Run Shell Command", "execute"),
      );

      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "allow-once",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("dangerouslyAllowAll"),
      );
    });

    it("should approve tools with matching toolKind", async () => {
      const logger = createMockLogger();
      const allowOwnTools: AllowOwnToolsConfig = {
        toolKinds: ["read", "search", "think"],
      };

      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger,
        allowOwnTools,
      });

      await client.connect();

      // Test "read" kind - should be approved
      const readResult = await capturedHandler!.requestPermission(
        createPermissionRequest("Read File", "read"),
      );
      expect(readResult.outcome).toEqual({
        outcome: "selected",
        optionId: "allow-once",
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("toolKind=read"),
      );

      // Test "search" kind - should be approved
      const searchResult = await capturedHandler!.requestPermission(
        createPermissionRequest("Search Code", "search"),
      );
      expect(searchResult.outcome).toEqual({
        outcome: "selected",
        optionId: "allow-once",
      });

      // Test "think" kind - should be approved
      const thinkResult = await capturedHandler!.requestPermission(
        createPermissionRequest("Think", "think"),
      );
      expect(thinkResult.outcome).toEqual({
        outcome: "selected",
        optionId: "allow-once",
      });
    });

    it("should deny tools with non-matching toolKind", async () => {
      const logger = createMockLogger();
      const allowOwnTools: AllowOwnToolsConfig = {
        toolKinds: ["read", "search"],
      };

      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger,
        allowOwnTools,
      });

      await client.connect();

      // Test "execute" kind - should be denied (not in allowed list)
      const executeResult = await capturedHandler!.requestPermission(
        createPermissionRequest("Run Shell", "execute"),
      );
      expect(executeResult.outcome).toEqual({ outcome: "cancelled" });

      // Test "edit" kind - should be denied
      const editResult = await capturedHandler!.requestPermission(
        createPermissionRequest("Edit File", "edit"),
      );
      expect(editResult.outcome).toEqual({ outcome: "cancelled" });

      // Test "delete" kind - should be denied
      const deleteResult = await capturedHandler!.requestPermission(
        createPermissionRequest("Delete File", "delete"),
      );
      expect(deleteResult.outcome).toEqual({ outcome: "cancelled" });
    });

    it("should deny tools with no kind when toolKinds is set", async () => {
      const logger = createMockLogger();
      const allowOwnTools: AllowOwnToolsConfig = {
        toolKinds: ["read"],
      };

      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger,
        allowOwnTools,
      });

      await client.connect();

      // Tool with no kind property - should be denied
      const result = await capturedHandler!.requestPermission(
        createPermissionRequest("Unknown Tool", undefined),
      );
      expect(result.outcome).toEqual({ outcome: "cancelled" });
    });

    it("should still approve sidecar tools via toolTag even without allowOwnTools", async () => {
      const logger = createMockLogger();

      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger,
        // No allowOwnTools config
      });

      await client.connect();

      // Create a session with a toolTag
      await client.createSession(undefined, undefined, "sidecar-abc123");

      // Tool with matching tag in title - should be approved
      const result = await capturedHandler!.requestPermission({
        sessionId: "acp-session-123",
        toolCall: {
          toolCallId: "sidecar-tool-call",
          title: "calculator [sidecar-abc123]",
          kind: undefined,
        },
        options: [
          { optionId: "allow-once", name: "Allow Once", kind: "allow_once" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      });

      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "allow-once",
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("toolTag"),
      );
    });

    it("should prioritize dangerouslyAllowAll over toolKinds", async () => {
      const logger = createMockLogger();
      const allowOwnTools: AllowOwnToolsConfig = {
        dangerouslyAllowAll: true,
        toolKinds: [], // Empty list would normally deny everything
      };

      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger,
        allowOwnTools,
      });

      await client.connect();

      // Should be approved via dangerouslyAllowAll, not denied by empty toolKinds
      const result = await capturedHandler!.requestPermission(
        createPermissionRequest("Execute Something", "execute"),
      );

      expect(result.outcome).toEqual({
        outcome: "selected",
        optionId: "allow-once",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("dangerouslyAllowAll"),
      );
    });

    it("should deny by default when no allowOwnTools config and no toolTag match", async () => {
      const logger = createMockLogger();

      const client = new ACPClient({
        config: { command: "node", args: ["agent.js"] },
        logger,
        // No allowOwnTools config
      });

      await client.connect();

      // Any tool without a matching tag should be denied
      const result = await capturedHandler!.requestPermission(
        createPermissionRequest("Random Tool", "execute"),
      );

      expect(result.outcome).toEqual({ outcome: "cancelled" });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("DENIED"),
      );
    });
  });
});
