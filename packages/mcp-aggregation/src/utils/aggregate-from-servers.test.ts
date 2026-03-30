import { describe, it, expect, vi } from "vitest";
import { aggregateFromServers } from "./aggregate-from-servers.js";
import type { IMCPClientSession, ILogger } from "../types.js";

function mockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as unknown as ILogger;
}

function mockClient(overrides?: Partial<IMCPClientSession>): IMCPClientSession {
  return {
    listTools: vi.fn(),
    listResources: vi.fn(),
    readResource: vi.fn(),
    listPrompts: vi.fn(),
    getPrompt: vi.fn(),
    listResourceTemplates: vi.fn(),
    complete: vi.fn(),
    getServerVersion: vi.fn(),
    getInstructions: vi.fn(),
    ...overrides,
  } as unknown as IMCPClientSession;
}

describe("aggregateFromServers", () => {
  it("aggregates results from multiple servers", async () => {
    const clients = new Map([
      ["server-a", mockClient()],
      ["server-b", mockClient()],
    ]);

    const results = await aggregateFromServers(
      clients,
      async (name) => `data-from-${name}`,
      mockLogger(),
    );

    expect(results).toEqual([
      { name: "server-a", result: "data-from-server-a" },
      { name: "server-b", result: "data-from-server-b" },
    ]);
  });

  it("returns empty array for no clients", async () => {
    const results = await aggregateFromServers(
      new Map(),
      async () => "unused",
      mockLogger(),
    );
    expect(results).toEqual([]);
  });

  it("skips servers that throw and logs the error", async () => {
    const logger = mockLogger();
    const clients = new Map([
      ["good", mockClient()],
      ["bad", mockClient()],
    ]);

    const results = await aggregateFromServers(
      clients,
      async (name) => {
        if (name === "bad") throw new Error("connection refused");
        return "ok";
      },
      logger,
    );

    expect(results).toEqual([{ name: "good", result: "ok" }]);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("suppresses errors matching suppressErrorContaining", async () => {
    const logger = mockLogger();
    const clients = new Map([["srv", mockClient()]]);

    const results = await aggregateFromServers(
      clients,
      async () => {
        throw new Error("Server does not support prompts");
      },
      logger,
      { suppressErrorContaining: "does not support" },
    );

    expect(results).toEqual([]);
    // Suppressed errors should NOT be logged
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("still logs errors that don't match the suppress pattern", async () => {
    const logger = mockLogger();
    const clients = new Map([["srv", mockClient()]]);

    const results = await aggregateFromServers(
      clients,
      async () => {
        throw new Error("timeout");
      },
      logger,
      { suppressErrorContaining: "does not support" },
    );

    expect(results).toEqual([]);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
