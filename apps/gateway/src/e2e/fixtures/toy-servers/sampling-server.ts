import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as z from "zod";
import { randomUUID } from "node:crypto";

/**
 * Creates an MCP server that uses sampling requests.
 * This server's tools will trigger sampling requests to the connected client,
 * which allows testing the sampling proxy functionality.
 */
function createSamplingServer(): McpServer {
  const server = new McpServer(
    {
      name: "sampling-test-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Tool that triggers a sampling request to ask the LLM a question
  server.registerTool(
    "ask_llm",
    {
      description:
        "Ask the LLM a question via sampling. This will send a sampling request to the connected client.",
      inputSchema: z.object({
        question: z.string().describe("The question to ask the LLM"),
      }),
    },
    async (args) => {
      const { question } = args as { question: string };

      // Send sampling request to the connected client (our proxy)
      // The proxy will forward this to its downstream client
      const result = await server.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: question,
            },
          },
        ],
        maxTokens: 100,
      });

      // Extract the text content from the response
      const responseText =
        result.content.type === "text"
          ? result.content.text
          : JSON.stringify(result.content);

      return {
        content: [
          {
            type: "text",
            text: `LLM responded: ${responseText}`,
          },
        ],
      };
    },
  );

  // Tool that asks a multi-turn question
  server.registerTool(
    "multi_turn_llm",
    {
      description:
        "Ask the LLM with context from previous messages. Tests multi-message sampling.",
      inputSchema: z.object({
        context: z.string().describe("Previous context/conversation"),
        question: z.string().describe("The new question to ask"),
      }),
    },
    async (args) => {
      const { context, question } = args as {
        context: string;
        question: string;
      };

      const result = await server.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: context,
            },
          },
          {
            role: "assistant",
            content: {
              type: "text",
              text: "I understand. Please continue.",
            },
          },
          {
            role: "user",
            content: {
              type: "text",
              text: question,
            },
          },
        ],
        maxTokens: 200,
      });

      const responseText =
        result.content.type === "text"
          ? result.content.text
          : JSON.stringify(result.content);

      return {
        content: [
          {
            type: "text",
            text: `Multi-turn response: ${responseText}`,
          },
        ],
      };
    },
  );

  return server;
}

/**
 * Starts the sampling server in HTTP mode on the specified port
 */
export async function startHttpSamplingServer(port: number): Promise<{
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
      const server = createSamplingServer();
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
 * Starts the sampling server in stdio mode (for use as child process)
 * This function does not return - it runs the server on stdin/stdout
 */
export async function startStdioSamplingServer(): Promise<never> {
  const server = createSamplingServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep process alive indefinitely
  return new Promise(() => {
    // Never resolves - keeps the process running forever
  });
}

// If this file is run directly, start in stdio mode
if (process.argv[1]) {
  const { fileURLToPath } = await import("node:url");
  const currentFile = fileURLToPath(import.meta.url);
  const mainFile = process.argv[1];

  if (currentFile === mainFile) {
    startStdioSamplingServer().catch(console.error);
  }
}
