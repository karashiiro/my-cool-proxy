import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as z from "zod";
import { randomUUID } from "node:crypto";

/**
 * Creates a calculator MCP server with basic math tools
 */
function createCalculatorServer(): McpServer {
  const server = new McpServer(
    {
      name: "calculator",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Add tool
  server.registerTool(
    "add",
    {
      description: "Add two numbers",
      inputSchema: z.object({
        a: z.number().describe("First number"),
        b: z.number().describe("Second number"),
      }),
    },
    async (args) => {
      const { a, b } = args as { a: number; b: number };
      return {
        content: [
          {
            type: "text",
            text: `${a} + ${b} = ${a + b}`,
          },
        ],
      };
    },
  );

  // Multiply tool
  server.registerTool(
    "multiply",
    {
      description: "Multiply two numbers",
      inputSchema: z.object({
        a: z.number().describe("First number"),
        b: z.number().describe("Second number"),
      }),
    },
    async (args) => {
      const { a, b } = args as { a: number; b: number };
      return {
        content: [
          {
            type: "text",
            text: `${a} * ${b} = ${a * b}`,
          },
        ],
      };
    },
  );

  // Subtract tool
  server.registerTool(
    "subtract",
    {
      description: "Subtract two numbers",
      inputSchema: z.object({
        a: z.number().describe("First number"),
        b: z.number().describe("Second number to subtract from first"),
      }),
    },
    async (args) => {
      const { a, b } = args as { a: number; b: number };
      return {
        content: [
          {
            type: "text",
            text: `${a} - ${b} = ${a - b}`,
          },
        ],
      };
    },
  );

  // Divide tool
  server.registerTool(
    "divide",
    {
      description: "Divide two numbers",
      inputSchema: z.object({
        a: z.number().describe("Dividend"),
        b: z.number().describe("Divisor"),
      }),
    },
    async (args) => {
      const { a, b } = args as { a: number; b: number };
      if (b === 0) {
        throw new Error("Cannot divide by zero");
      }
      return {
        content: [
          {
            type: "text",
            text: `${a} / ${b} = ${a / b}`,
          },
        ],
      };
    },
  );

  return server;
}

/**
 * Starts the calculator server in HTTP mode on the specified port
 */
export async function startHttpCalculatorServer(port: number): Promise<{
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
      const server = createCalculatorServer();
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

/**
 * Starts the calculator server in stdio mode (for use as child process)
 * This function does not return - it runs the server on stdin/stdout
 */
export async function startStdioCalculatorServer(): Promise<never> {
  const server = createCalculatorServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep process alive indefinitely
  // The transport handles stdin/stdout, we just need to prevent exit
  return new Promise(() => {
    // Never resolves - keeps the process running forever
  });
}

// If this file is run directly, start in stdio mode
// Check if this is the main module
if (process.argv[1]) {
  const { fileURLToPath } = await import("node:url");
  const currentFile = fileURLToPath(import.meta.url);
  const mainFile = process.argv[1];

  if (currentFile === mainFile) {
    startStdioCalculatorServer().catch(console.error);
  }
}
