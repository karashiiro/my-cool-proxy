import { describe, it, expect, vi } from "vitest";
import {
  formatServerNotFoundError,
  formatServerList,
} from "./error-formatting.js";
import type { IMCPClientSession } from "../types.js";

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

describe("formatServerList", () => {
  it("should return 'none' for empty map", () => {
    const clients = new Map<string, IMCPClientSession>();
    expect(formatServerList(clients)).toBe("none");
  });

  it("should format server names with Lua sanitization by default", () => {
    const clients = new Map<string, IMCPClientSession>([
      ["github-server", createMockClient()],
      ["slack-api", createMockClient()],
    ]);
    expect(formatServerList(clients)).toBe("github_server, slack_api");
  });

  it("should format server names without Lua sanitization when disabled", () => {
    const clients = new Map<string, IMCPClientSession>([
      ["github-server", createMockClient()],
      ["slack-api", createMockClient()],
    ]);
    expect(formatServerList(clients, false)).toBe("github-server, slack-api");
  });
});

describe("formatServerNotFoundError", () => {
  it("should format error without session ID", () => {
    const clients = new Map<string, IMCPClientSession>([
      ["github", createMockClient()],
      ["slack", createMockClient()],
    ]);

    const result = formatServerNotFoundError({
      serverName: "invalid_server",
      clients,
    });

    expect(result).toBe(
      "Server 'invalid_server' not found.\n\nAvailable servers: github, slack",
    );
  });

  it("should format error with session ID", () => {
    const clients = new Map<string, IMCPClientSession>([
      ["github", createMockClient()],
      ["slack", createMockClient()],
    ]);

    const result = formatServerNotFoundError({
      serverName: "invalid_server",
      clients,
      sessionId: "test-session",
    });

    expect(result).toBe(
      "Server 'invalid_server' not found in session 'test-session'.\n\nAvailable servers: github, slack",
    );
  });

  it("should show 'none' when no servers available", () => {
    const clients = new Map<string, IMCPClientSession>();

    const result = formatServerNotFoundError({
      serverName: "any_server",
      clients,
    });

    expect(result).toBe(
      "Server 'any_server' not found.\n\nAvailable servers: none",
    );
  });

  it("should sanitize server names to Lua identifiers by default", () => {
    const clients = new Map<string, IMCPClientSession>([
      ["github-api", createMockClient()],
      ["slack-webhook", createMockClient()],
    ]);

    const result = formatServerNotFoundError({
      serverName: "invalid",
      clients,
    });

    expect(result).toContain("github_api, slack_webhook");
  });

  it("should preserve original server names when useLuaIdentifiers is false", () => {
    const clients = new Map<string, IMCPClientSession>([
      ["github-api", createMockClient()],
      ["slack-webhook", createMockClient()],
    ]);

    const result = formatServerNotFoundError({
      serverName: "invalid",
      clients,
      useLuaIdentifiers: false,
    });

    expect(result).toContain("github-api, slack-webhook");
  });
});
