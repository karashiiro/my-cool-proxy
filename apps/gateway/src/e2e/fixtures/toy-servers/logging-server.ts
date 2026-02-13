import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as z from "zod";
import { randomUUID } from "node:crypto";

/**
 * Creates a logging MCP server that emits logging notifications
 * when tools are called. Used for e2e testing of log forwarding.
 */
function createLoggingServer(): McpServer {
  const server = new McpServer(
    {
      name: "logging-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    },
  );

  // Tool that emits a log message at various levels
  server.registerTool(
    "emit_log",
    {
      description: "Emits a logging notification at the specified level",
      inputSchema: z.object({
        level: z
          .enum([
            "debug",
            "info",
            "notice",
            "warning",
            "error",
            "critical",
            "alert",
            "emergency",
          ])
          .describe("Log level"),
        message: z.string().describe("Log message"),
        logger: z.string().optional().describe("Optional logger name"),
      }),
    },
    async (args) => {
      const { level, message, logger } = args as {
        level:
          | "debug"
          | "info"
          | "notice"
          | "warning"
          | "error"
          | "critical"
          | "alert"
          | "emergency";
        message: string;
        logger?: string;
      };

      // Emit the logging notification
      server.sendLoggingMessage({
        level,
        logger,
        data: { message, timestamp: new Date().toISOString() },
      });

      return {
        content: [
          {
            type: "text",
            text: `Emitted ${level} log: ${message}`,
          },
        ],
      };
    },
  );

  // Tool that emits multiple logs in sequence
  server.registerTool(
    "emit_multiple_logs",
    {
      description: "Emits multiple logging notifications at different levels",
      inputSchema: z.object({
        count: z.number().describe("Number of logs to emit"),
      }),
    },
    async (args) => {
      const { count } = args as { count: number };
      const levels = ["debug", "info", "warning", "error"] as const;

      for (let i = 0; i < count; i++) {
        const level = levels[i % levels.length]!;
        server.sendLoggingMessage({
          level,
          logger: "batch-logger",
          data: { index: i, total: count },
        });
      }

      return {
        content: [
          {
            type: "text",
            text: `Emitted ${count} log messages`,
          },
        ],
      };
    },
  );

  return server;
}

/**
 * Starts the logging server in HTTP mode on the specified port
 */
export async function startHttpLoggingServer(port: number): Promise<{
  close: () => Promise<void>;
}> {
  // Track transports and servers per session
  const transports = new Map<
    string,
    WebStandardStreamableHTTPServerTransport
  >();
  const servers = new Map<string, McpServer>();

  // Create HTTP server with Hono
  const app = new Hono();
  app.all("/mcp", async (c) => {
    const sessionId = c.req.header("mcp-session-id");

    // Parse body to check if it's an initialize request
    const rawRequest = c.req.raw;
    const bodyText = await rawRequest.text();
    let body: unknown = null;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      // Invalid JSON
    }

    // Helper to recreate request (since we consumed the body)
    const recreateRequest = () =>
      new Request(rawRequest.url, {
        method: rawRequest.method,
        headers: rawRequest.headers,
        body: bodyText || undefined,
      });

    // New session: no session ID and initialize request
    if (!sessionId && body && isInitializeRequest(body)) {
      const newSessionId = randomUUID();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      });
      const server = createLoggingServer();
      await server.connect(transport);

      transports.set(newSessionId, transport);
      servers.set(newSessionId, server);

      return transport.handleRequest(recreateRequest());
    }

    // Existing session
    if (sessionId) {
      const transport = transports.get(sessionId);
      if (!transport) {
        return c.text("Session not found", 404);
      }
      return transport.handleRequest(recreateRequest());
    }

    // Invalid request (no session ID, not an initialize request)
    return c.text("Bad request - missing session ID", 400);
  });

  const httpServer = serve({
    fetch: app.fetch,
    port,
    hostname: "localhost",
  });

  return {
    close: async () => {
      // Close all servers and transports
      for (const server of servers.values()) {
        await server.close();
      }
      transports.clear();
      servers.clear();

      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
