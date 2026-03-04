import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Progress } from "@modelcontextprotocol/sdk/types.js";
import { allocatePort } from "../helpers/port-manager.js";
import { generateHttpTestConfig } from "../helpers/test-config-generator.js";
import { HttpServerManager } from "../helpers/http-server-manager.js";
import { ToyServerManager } from "../helpers/toy-server-manager.js";
import { assertTextContains } from "../helpers/test-assertions.js";
import {
  waitForServersReady,
  inspectAllTools,
} from "../helpers/client-helpers.js";

describe("Progress Notification Proxy E2E (HTTP Mode)", () => {
  let gatewayPort: number;
  let progressServerPort: number;
  let gatewayManager: HttpServerManager;
  let toyServers: ToyServerManager;
  let gatewayClient: Client;
  let configCleanup: () => void;

  beforeAll(async () => {
    // Allocate ports
    gatewayPort = await allocatePort();
    progressServerPort = await allocatePort();

    // Start the progress toy server
    toyServers = new ToyServerManager();
    await toyServers.startHttp("progress", progressServerPort);

    // Generate config with the progress server
    const configResult = generateHttpTestConfig({
      port: gatewayPort,
      host: "localhost",
      mcpClients: {
        "progress-test-server": {
          type: "http",
          url: `http://localhost:${progressServerPort}/mcp`,
        },
      },
    });
    configCleanup = configResult.cleanup;

    // Set CONFIG_PATH for the gateway to use
    process.env.CONFIG_PATH = configResult.configPath;

    // Start the gateway
    gatewayManager = new HttpServerManager();
    await gatewayManager.start({
      transport: "http",
      port: gatewayPort,
      host: "localhost",
      mcpClients: {
        "progress-test-server": {
          type: "http",
          url: `http://localhost:${progressServerPort}/mcp`,
        },
      },
    });

    // Create a client
    gatewayClient = new Client(
      {
        name: "progress-e2e-client",
        version: "1.0.0",
      },
      { capabilities: {} },
    );

    // Connect to the gateway
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${gatewayPort}/mcp`),
    );
    await gatewayClient.connect(transport);

    // Wait for upstream servers to be ready
    await waitForServersReady(gatewayClient, 1);
    await inspectAllTools(gatewayClient);
  }, 30000);

  afterAll(async () => {
    await gatewayClient?.close();
    await gatewayManager?.stop();
    await toyServers?.stopAll();
    configCleanup?.();
  });

  describe("Progress notification forwarding", () => {
    it("should list the progress server", async () => {
      const result = await gatewayClient.callTool({
        name: "list-servers",
        arguments: {},
      });

      assertTextContains(result, "progress_test_server");
    });

    it("should forward progress from a single upstream tool call", async () => {
      const progressUpdates: Progress[] = [];

      const script = `
        local res = progress_test_server.slow_task({ steps = 5 }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool(
        { name: "execute", arguments: { script } },
        undefined,
        {
          onprogress: (p) => {
            progressUpdates.push(p);
          },
        },
      );

      assertTextContains(result, "Completed slow task with 5 steps");

      // Should have received progress notifications
      expect(progressUpdates.length).toBeGreaterThan(0);

      // The last progress update should be 100/100
      const lastProgressItem = progressUpdates[progressUpdates.length - 1];
      if (!lastProgressItem)
        throw new Error("expected last progress item to be defined");
      expect(lastProgressItem.progress).toBe(100);
      expect(lastProgressItem.total).toBe(100);

      // Progress should be monotonically non-decreasing
      for (let i = 1; i < progressUpdates.length; i++) {
        const cur = progressUpdates[i];
        const prev = progressUpdates[i - 1];
        if (!cur)
          throw new Error(`expected progressUpdates[${i}] to be defined`);
        if (!prev)
          throw new Error(`expected progressUpdates[${i - 1}] to be defined`);
        expect(cur.progress).toBeGreaterThanOrEqual(prev.progress);
      }
    });

    it("should aggregate progress from concurrent upstream tool calls", async () => {
      const progressUpdates: Progress[] = [];

      // Call two slow_task tools concurrently via Lua
      const script = `
        local p1 = progress_test_server.slow_task({ steps = 3 })
        local p2 = progress_test_server.slow_task({ steps = 3 })
        local r1 = p1:await()
        local r2 = p2:await()
        result({ first = r1, second = r2 })
      `;

      const result = await gatewayClient.callTool(
        { name: "execute", arguments: { script } },
        undefined,
        {
          onprogress: (p) => {
            progressUpdates.push(p);
          },
        },
      );

      // Both tool calls should have completed
      expect(result.isError).toBeFalsy();

      // Should have received progress notifications
      expect(progressUpdates.length).toBeGreaterThan(0);

      // The final progress should be aggregated (200/200 for two 100/100 tasks)
      const lastProgressItem = progressUpdates[progressUpdates.length - 1];
      if (!lastProgressItem)
        throw new Error("expected last progress item to be defined");
      expect(lastProgressItem.progress).toBe(200);
      expect(lastProgressItem.total).toBe(200);
    });

    it("should handle progress without total (undefined total propagation)", async () => {
      const progressUpdates: Progress[] = [];

      const script = `
        local res = progress_test_server.slow_task_no_total({ steps = 3 }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool(
        { name: "execute", arguments: { script } },
        undefined,
        {
          onprogress: (p) => {
            progressUpdates.push(p);
          },
        },
      );

      assertTextContains(result, "Completed slow task (no total) with 3 steps");

      // Should have received progress notifications
      expect(progressUpdates.length).toBeGreaterThan(0);

      // Total should be undefined for all progress updates since the upstream
      // tool never provides a total
      for (const update of progressUpdates) {
        expect(update.total).toBeUndefined();
      }
    });

    it("should aggregate with mixed total/no-total (total becomes undefined)", async () => {
      const progressUpdates: Progress[] = [];

      // Call one task with total and one without — aggregate total should be undefined
      const script = `
        local p1 = progress_test_server.slow_task({ steps = 3 })
        local p2 = progress_test_server.slow_task_no_total({ steps = 3 })
        local r1 = p1:await()
        local r2 = p2:await()
        result({ first = r1, second = r2 })
      `;

      const result = await gatewayClient.callTool(
        { name: "execute", arguments: { script } },
        undefined,
        {
          onprogress: (p) => {
            progressUpdates.push(p);
          },
        },
      );

      expect(result.isError).toBeFalsy();

      // Should have received progress notifications
      expect(progressUpdates.length).toBeGreaterThan(0);

      // Since slow_task_no_total has no total, the aggregated total should
      // eventually become undefined once the no-total task starts reporting
      const hasUndefinedTotal = progressUpdates.some(
        (p) => p.total === undefined,
      );
      expect(hasUndefinedTotal).toBe(true);
    });

    it("should execute normally without errors when no progressToken is provided", async () => {
      const script = `
        local res = progress_test_server.slow_task({ steps = 2 }):await()
        result(res)
      `;

      // Call without onprogress — no progressToken sent
      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // Should still work fine
      assertTextContains(result, "Completed slow task with 2 steps");
      expect(result.isError).toBeFalsy();
    });
  });
});
