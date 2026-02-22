import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serveStdio } from "@karashiiro/mcp/stdio";
import { serveHttp } from "@karashiiro/mcp/http";
import * as z from "zod";

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

  // Tool that triggers a URL-mode elicitation request
  server.registerTool(
    "ask_user_url",
    {
      description:
        "Ask the user to navigate to a URL. This will send a URL-mode elicitation request to the connected client.",
      inputSchema: z.object({
        prompt: z.string().describe("The prompt/message to show the user"),
        url: z.string().describe("The URL for the user to navigate to"),
      }),
    },
    async (args) => {
      const { prompt, url } = args as { prompt: string; url: string };

      // Send URL-mode elicitation request to the connected client
      const result = await server.server.elicitInput({
        mode: "url",
        message: prompt,
        elicitationId: `url-elicit-${Date.now()}`,
        url,
      });

      if (result.action === "accept") {
        return {
          content: [
            {
              type: "text",
              text: `User accepted URL elicitation for: ${url}`,
            },
          ],
        };
      } else if (result.action === "decline") {
        return {
          content: [
            {
              type: "text",
              text: "User declined the URL elicitation request",
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: "text",
              text: `URL elicitation completed with action: ${result.action}`,
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
export async function startHttpElicitationServer(port: number) {
  return serveHttp(() => createElicitationServer(), {
    port,
    host: "localhost",
    endpoint: "/mcp",
    sessions: {},
  });
}

/**
 * Starts the elicitation server in stdio mode (for use as child process)
 * This function does not return - it runs the server on stdin/stdout
 */
export async function startStdioElicitationServer() {
  return serveStdio(() => createElicitationServer());
}

// If this file is run directly, start in stdio mode
if (process.argv[1]) {
  const { fileURLToPath } = await import("node:url");
  const currentFile = fileURLToPath(import.meta.url);
  const mainFile = process.argv[1];

  if (currentFile === mainFile) {
    await startStdioElicitationServer();
  }
}
