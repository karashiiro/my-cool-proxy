import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { ACPClient, type ILogger } from "@my-cool-proxy/acp-client";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

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

    // Set up mock process
    mockProcess = {
      stdin: { write: vi.fn() } as unknown as ChildProcess["stdin"],
      stdout: { read: vi.fn() } as unknown as ChildProcess["stdout"],
      kill: vi.fn(),
      on: vi.fn(),
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
    const { spawn } = await import("child_process");
    vi.mocked(spawn).mockReturnValue(mockProcess as ChildProcess);

    // Configure ClientSideConnection mock
    const acp = await import("@agentclientprotocol/sdk");
    vi.mocked(acp.ClientSideConnection).mockImplementation(function () {
      return mockConnection as unknown as InstanceType<
        typeof acp.ClientSideConnection
      >;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("connect", () => {
    it("should spawn process with correct command and args", async () => {
      const client = new ACPClient(
        { command: "node", args: ["agent.js"] },
        createMockLogger(),
      );

      await client.connect();

      expect(spawn).toHaveBeenCalledWith("node", ["agent.js"], {
        stdio: ["pipe", "pipe", "inherit"],
        env: undefined,
        shell: true,
      });
    });

    it("should pass environment variables to spawned process", async () => {
      const client = new ACPClient(
        { command: "node", args: ["agent.js"], env: { MODEL: "gpt-4" } },
        createMockLogger(),
      );

      await client.connect();

      expect(spawn).toHaveBeenCalledWith("node", ["agent.js"], {
        stdio: ["pipe", "pipe", "inherit"],
        env: expect.objectContaining({ MODEL: "gpt-4" }),
        shell: true,
      });
    });

    it("should initialize the ACP connection with protocol version", async () => {
      const client = new ACPClient(
        { command: "node", args: ["agent.js"] },
        createMockLogger(),
      );

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

      const client = new ACPClient(
        { command: "node", args: ["agent.js"] },
        createMockLogger(),
      );

      await expect(client.connect()).rejects.toThrow(
        /Failed to create stdio streams/,
      );
    });

    it("should use default empty args when none provided", async () => {
      const client = new ACPClient({ command: "my-agent" }, createMockLogger());

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

      const client = new ACPClient(
        { command: "node", args: ["agent.js"] },
        createMockLogger(),
      );

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

      const client = new ACPClient(
        { command: "node", args: ["agent.js"] },
        createMockLogger(),
      );

      await client.connect();

      expect(client.promptCapabilities).toEqual({});
    });
  });

  describe("createSession", () => {
    it("should create a new ACP session via the connection", async () => {
      const client = new ACPClient(
        { command: "node", args: ["agent.js"] },
        createMockLogger(),
      );

      await client.connect();
      const session = await client.createSession();

      expect(mockConnection.newSession).toHaveBeenCalledWith({
        cwd: expect.any(String),
        mcpServers: [],
      });
      expect(session).toBeDefined();
    });

    it("should throw if not connected", async () => {
      const client = new ACPClient(
        { command: "node", args: ["agent.js"] },
        createMockLogger(),
      );

      await expect(client.createSession()).rejects.toThrow(/not connected/);
    });

    it("should return an ACPClientSession that can prompt", async () => {
      const client = new ACPClient(
        { command: "node", args: ["agent.js"] },
        createMockLogger(),
      );

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
      const client = new ACPClient(
        { command: "node", args: ["agent.js"] },
        createMockLogger(),
      );

      await client.connect();
      await client.close();

      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it("should be safe to call when not connected", async () => {
      const client = new ACPClient(
        { command: "node", args: ["agent.js"] },
        createMockLogger(),
      );

      // Should not throw
      await client.close();
    });

    it("should prevent createSession after close", async () => {
      const client = new ACPClient(
        { command: "node", args: ["agent.js"] },
        createMockLogger(),
      );

      await client.connect();
      await client.close();

      await expect(client.createSession()).rejects.toThrow(/not connected/);
    });
  });
});
