import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serveHttp } from "@karashiiro/mcp/http";
import * as z from "zod";

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
        const level = levels[i % levels.length] ?? "info";
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
export async function startHttpLoggingServer(port: number) {
  return serveHttp(() => createLoggingServer(), {
    port,
    host: "localhost",
    endpoint: "/mcp",
    sessions: {},
  });
}
