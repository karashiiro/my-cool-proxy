import { describe, it, expect, vi } from "vitest";
import { lookupServerOrThrow } from "./server-lookup.js";
import type { IMCPClientManager, IMCPClientSession } from "../types.js";

// Mock client factory
function createMockClient(): IMCPClientSession {
  return {
    getServerVersion: vi.fn(),
    getInstructions: vi.fn(),
    listTools: vi.fn(),
    listResources: vi.fn(),
    listPrompts: vi.fn(),
    callTool: vi.fn(),
    readResource: vi.fn(),
    getPrompt: vi.fn(),
    createMessage: vi.fn(),
    elicit: vi.fn(),
    close: vi.fn(),
    setRequestHandler: vi.fn(),
  } as unknown as IMCPClientSession;
}

// Mock client pool factory
function createMockClientPool(
  clients: Map<string, IMCPClientSession>,
): IMCPClientManager {
  return {
    getClientsBySession: vi.fn().mockReturnValue(clients),
    getFailedServers: vi.fn().mockReturnValue(new Map()),
    connectClient: vi.fn(),
    removeClient: vi.fn(),
    removeSession: vi.fn(),
    closeAll: vi.fn(),
    setResourceListChangedHandler: vi.fn(),
    setPromptListChangedHandler: vi.fn(),
    setToolListChangedHandler: vi.fn(),
  } as unknown as IMCPClientManager;
}

describe("lookupServerOrThrow", () => {
  it("should return client when server is found", () => {
    const mockClient = createMockClient();
    const clients = new Map<string, IMCPClientSession>([
      ["github", mockClient],
      ["slack", createMockClient()],
    ]);
    const clientPool = createMockClientPool(clients);

    const result = lookupServerOrThrow({
      serverName: "github",
      sessionId: "test-session",
      clientPool,
    });

    expect(result.client).toBe(mockClient);
    expect(result.clients).toBe(clients);
  });

  it("should throw error with available servers when not found", () => {
    const clients = new Map<string, IMCPClientSession>([
      ["github", createMockClient()],
      ["slack", createMockClient()],
    ]);
    const clientPool = createMockClientPool(clients);

    expect(() =>
      lookupServerOrThrow({
        serverName: "nonexistent",
        sessionId: "test-session",
        clientPool,
      }),
    ).toThrow(
      "Server 'nonexistent' not found in session 'test-session'. Available servers: github, slack",
    );
  });

  it("should show 'none' when no servers available", () => {
    const clients = new Map<string, IMCPClientSession>();
    const clientPool = createMockClientPool(clients);

    expect(() =>
      lookupServerOrThrow({
        serverName: "any",
        sessionId: "test",
        clientPool,
      }),
    ).toThrow(
      "Server 'any' not found in session 'test'. Available servers: none",
    );
  });

  it("should call getClientsBySession with correct session ID", () => {
    const clients = new Map<string, IMCPClientSession>([
      ["github", createMockClient()],
    ]);
    const clientPool = createMockClientPool(clients);

    lookupServerOrThrow({
      serverName: "github",
      sessionId: "my-custom-session",
      clientPool,
    });

    expect(clientPool.getClientsBySession).toHaveBeenCalledWith(
      "my-custom-session",
    );
  });
});
