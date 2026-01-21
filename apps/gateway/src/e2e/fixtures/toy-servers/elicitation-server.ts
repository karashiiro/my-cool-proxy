import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as z from "zod";
import { randomUUID } from "node:crypto";

/**
 * Creates an MCP server that uses elicitation requests.
 * This server's tools will trigger elicitation requests to the connected client,
 * which allows testing the elicitation proxy functionality.
 */
function createElicitationServer(): McpServer {
  const server = new McpServer(
    {
      name: "elicitation-test-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Tool that triggers a form elicitation request
  server.registerTool(
    "ask_user_form",
    {
      description:
        "Ask the user for structured input via a form. This will send an elicitation request to the connected client.",
      inputSchema: z.object({
        prompt: z.string().describe("The prompt/message to show the user"),
      }),
    },
    async (args) => {
      const { prompt } = args as { prompt: string };

      // Send form elicitation request to the connected client
      const result = await server.server.elicitInput({
        message: prompt,
        requestedSchema: {
          type: "object" as const,
          properties: {
            response: {
              type: "string",
              title: "Your response",
              description: "Please enter your response",
            },
          },
          required: ["response"],
        },
      });

      if (result.action === "accept" && result.content) {
        const content = result.content as Record<string, unknown>;
        return {
          content: [
            {
              type: "text",
              text: `User accepted with response: ${content.response}`,
            },
          ],
        };
      } else if (result.action === "decline") {
        return {
          content: [
            {
              type: "text",
              text: "User declined the elicitation request",
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Elicitation completed with action: ${result.action}`,
            },
          ],
        };
      }
    },
  );

  // Tool that asks for multiple fields
  server.registerTool(
    "ask_user_details",
    {
      description: "Ask the user for multiple details via a form",
      inputSchema: z.object({
        prompt: z.string().describe("The prompt/message to show the user"),
      }),
    },
    async (args) => {
      const { prompt } = args as { prompt: string };

      const result = await server.server.elicitInput({
        message: prompt,
        requestedSchema: {
          type: "object" as const,
          properties: {
            name: {
              type: "string",
              title: "Name",
              description: "Your name",
            },
            age: {
              type: "number",
              title: "Age",
              description: "Your age",
            },
            confirmed: {
              type: "boolean",
              title: "Confirmed",
              description: "Do you confirm?",
            },
          },
          required: ["name"],
        },
      });

      if (result.action === "accept" && result.content) {
        const content = result.content as Record<string, unknown>;
        return {
          content: [
            {
              type: "text",
              text: `User details - Name: ${content.name}, Age: ${content.age ?? "not provided"}, Confirmed: ${content.confirmed ?? "not provided"}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Elicitation ${result.action}`,
            },
          ],
        };
      }
    },
  );

  return server;
}

/**
 * Starts the elicitation server in HTTP mode on the specified port
 */
export async function startHttpElicitationServer(port: number): Promise<{
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
      const server = createElicitationServer();
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
 * Starts the elicitation server in stdio mode (for use as child process)
 * This function does not return - it runs the server on stdin/stdout
 */
export async function startStdioElicitationServer(): Promise<never> {
  const server = createElicitationServer();
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
    startStdioElicitationServer().catch(console.error);
  }
}
