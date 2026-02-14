import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serveStdio } from "@karashiiro/mcp/stdio";
import { serveHttp } from "@karashiiro/mcp/http";
import * as z from "zod";

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
export async function startHttpSamplingServer(port: number) {
  return serveHttp(() => createSamplingServer(), {
    port,
    host: "localhost",
    endpoint: "/mcp",
    sessions: {},
  });
}

/**
 * Starts the sampling server in stdio mode (for use as child process)
 * This function does not return - it runs the server on stdin/stdout
 */
export async function startStdioSamplingServer() {
  return serveStdio(() => createSamplingServer());
}

// If this file is run directly, start in stdio mode
if (process.argv[1]) {
  const { fileURLToPath } = await import("node:url");
  const currentFile = fileURLToPath(import.meta.url);
  const mainFile = process.argv[1];

  if (currentFile === mainFile) {
    await startStdioSamplingServer();
  }
}
