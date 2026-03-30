import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { allocatePort } from "../helpers/port-manager.js";
import { generateHttpTestConfig } from "../helpers/test-config-generator.js";
import { HttpServerManager } from "../helpers/http-server-manager.js";
import { ToyServerManager } from "../helpers/toy-server-manager.js";
import { assertTextContains } from "../helpers/test-assertions.js";
import {
  waitForServersReady,
  inspectAllTools,
} from "../helpers/client-helpers.js";

describe("Logging Notification Proxy E2E (HTTP Mode)", () => {
  let gatewayPort: number;
  let loggingServerPort: number;
  let gatewayManager: HttpServerManager;
  let toyServers: ToyServerManager;
  let gatewayClient: Client;
  let configCleanup: () => void;
  let receivedLogs: Array<{
    level: string;
    logger?: string;
    data: unknown;
  }>;

  beforeAll(async () => {
    // Allocate ports
    gatewayPort = await allocatePort();
    loggingServerPort = await allocatePort();

    // Start the logging toy server
    toyServers = new ToyServerManager();
    await toyServers.startHttp("logging", loggingServerPort);

    // Generate config with the logging server
    const configResult = generateHttpTestConfig({
      port: gatewayPort,
      host: "localhost",
      mcpClients: {
        "logging-test-server": {
          type: "http",
          url: `http://localhost:${loggingServerPort}/mcp`,
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
        "logging-test-server": {
          type: "http",
          url: `http://localhost:${loggingServerPort}/mcp`,
        },
      },
    });

    // Create a client and set up logging notification handler
    receivedLogs = [];

    gatewayClient = new Client(
      {
        name: "logging-e2e-client",
        version: "1.0.0",
      },
      { capabilities: {} },
    );

    // Register handler for logging notifications BEFORE connecting
    gatewayClient.setNotificationHandler(
      LoggingMessageNotificationSchema,
      async (notification) => {
        receivedLogs.push({
          level: notification.params.level,
          logger: notification.params.logger,
          data: notification.params.data,
        });
      },
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

  describe("Logging notification forwarding", () => {
    it("should list the logging server", async () => {
      const result = await gatewayClient.callTool({
        name: "list-servers",
        arguments: {},
      });

      assertTextContains(result, "logging_test_server");
    });

    it("should list logging server tools", async () => {
      const result = await gatewayClient.callTool({
        name: "list-server-tools",
        arguments: { luaServerName: "logging_test_server" },
      });

      assertTextContains(result, "emit_log");
      assertTextContains(result, "emit_multiple_logs");
    });

    it("should forward logging notification with prefixed logger", async () => {
      // Clear any previous logs
      receivedLogs.length = 0;

      // Trigger a log from the upstream server
      const script = `
        local res = logging_test_server.emit_log({
          level = "info",
          message = "Test log message",
          logger = "my-logger"
        }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      assertTextContains(result, "Emitted info log");

      // Wait a bit for the notification to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify we received the logging notification
      expect(receivedLogs.length).toBeGreaterThanOrEqual(1);

      // Find the log we emitted
      const ourLog = receivedLogs.find(
        (log) =>
          log.level === "info" &&
          typeof log.data === "object" &&
          log.data !== null &&
          "message" in log.data &&
          (log.data as { message: string }).message === "Test log message",
      );

      expect(ourLog).toBeDefined();
      if (!ourLog) throw new Error("expected ourLog to be defined");
      // Logger should be prefixed with server name
      expect(ourLog.logger).toBe("[logging-test-server] my-logger");
    });

    it("should use server name as logger when no logger provided", async () => {
      // Clear any previous logs
      receivedLogs.length = 0;

      // Trigger a log without specifying a logger
      const script = `
        local res = logging_test_server.emit_log({
          level = "warning",
          message = "Log without logger"
        }):await()
        result(res)
      `;

      await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // Wait a bit for the notification to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Find the log we emitted
      const ourLog = receivedLogs.find(
        (log) =>
          log.level === "warning" &&
          typeof log.data === "object" &&
          log.data !== null &&
          "message" in log.data &&
          (log.data as { message: string }).message === "Log without logger",
      );

      expect(ourLog).toBeDefined();
      if (!ourLog) throw new Error("expected ourLog to be defined");
      // Logger should be just the server name in brackets
      expect(ourLog.logger).toBe("[logging-test-server]");
    });

    it("should forward multiple logs in sequence", async () => {
      // Clear any previous logs
      receivedLogs.length = 0;

      // Trigger multiple logs
      const script = `
        local res = logging_test_server.emit_multiple_logs({
          count = 4
        }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      assertTextContains(result, "Emitted 4 log messages");

      // Wait a bit for all notifications to be processed
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify we received multiple logs with batch-logger
      const batchLogs = receivedLogs.filter(
        (log) => log.logger === "[logging-test-server] batch-logger",
      );

      expect(batchLogs.length).toBe(4);

      // Verify different levels were used
      const levels = batchLogs.map((log) => log.level);
      expect(levels).toContain("debug");
      expect(levels).toContain("info");
      expect(levels).toContain("warning");
      expect(levels).toContain("error");
    });

    it("should preserve structured data in log messages", async () => {
      // Clear any previous logs
      receivedLogs.length = 0;

      // Trigger a log with structured data
      const script = `
        local res = logging_test_server.emit_log({
          level = "debug",
          message = "Structured data test",
          logger = "data-test"
        }):await()
        result(res)
      `;

      await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // Wait for notification
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Find our log
      const ourLog = receivedLogs.find(
        (log) =>
          log.logger === "[logging-test-server] data-test" &&
          log.level === "debug",
      );

      expect(ourLog).toBeDefined();
      if (!ourLog) throw new Error("expected ourLog to be defined");
      expect(typeof ourLog.data).toBe("object");

      const data = ourLog.data as { message: string; timestamp: string };
      expect(data.message).toBe("Structured data test");
      expect(data.timestamp).toBeDefined();
      // Verify timestamp is a valid ISO string
      expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
    });
  });
});
