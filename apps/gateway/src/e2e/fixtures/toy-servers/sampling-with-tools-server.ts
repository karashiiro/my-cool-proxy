import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as z from "zod";
import { randomUUID } from "node:crypto";

/**
 * Extract text from a createMessage result, handling various content formats.
 * The result type varies depending on whether tools were included in the request.
 */
function extractResponseText(result: { content: unknown }): string {
  const content = result.content;
  if (Array.isArray(content)) {
    // Array of content blocks
    const textBlocks = content.filter(
      (c): c is { type: "text"; text: string } =>
        typeof c === "object" && c !== null && "type" in c && c.type === "text",
    );
    if (textBlocks.length > 0) {
      return textBlocks.map((c) => c.text).join("\n");
    }
    return JSON.stringify(content);
  } else if (typeof content === "object" && content !== null) {
    // Single content block
    if ("type" in content && content.type === "text" && "text" in content) {
      return String(content.text);
    }
    return JSON.stringify(content);
  }
  return String(content);
}

/**
 * Creates an MCP server that sends sampling requests WITH tools.
 * This tests the dynamic tool sidecar functionality where tools
 * are injected into ACP sessions on-the-fly.
 */
function createSamplingWithToolsServer(): McpServer {
  const server = new McpServer(
    {
      name: "sampling-with-tools-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Tool that triggers a sampling request with calculator tools available
  server.registerTool(
    "ask_with_calculator",
    {
      description:
        "Ask the LLM a question and provide calculator tools for it to use. " +
        "The LLM can use add, subtract, multiply, divide tools to solve math problems.",
      inputSchema: z.object({
        question: z.string().describe("The math question to ask the LLM"),
      }),
    },
    async (args) => {
      const { question } = args as { question: string };

      // Send sampling request WITH tools
      const result = await server.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `You have access to calculator tools. Please solve: ${question}`,
            },
          },
        ],
        maxTokens: 500,
        // Include tools in the sampling request!
        // These will be exposed to the ACP agent via the sidecar
        tools: [
          {
            name: "add",
            description: "Add two numbers together",
            inputSchema: {
              type: "object" as const,
              properties: {
                a: { type: "number", description: "First number" },
                b: { type: "number", description: "Second number" },
              },
              required: ["a", "b"],
            },
          },
          {
            name: "subtract",
            description: "Subtract second number from first",
            inputSchema: {
              type: "object" as const,
              properties: {
                a: { type: "number", description: "First number" },
                b: { type: "number", description: "Second number" },
              },
              required: ["a", "b"],
            },
          },
          {
            name: "multiply",
            description: "Multiply two numbers",
            inputSchema: {
              type: "object" as const,
              properties: {
                a: { type: "number", description: "First number" },
                b: { type: "number", description: "Second number" },
              },
              required: ["a", "b"],
            },
          },
          {
            name: "divide",
            description: "Divide first number by second",
            inputSchema: {
              type: "object" as const,
              properties: {
                a: { type: "number", description: "Dividend" },
                b: { type: "number", description: "Divisor" },
              },
              required: ["a", "b"],
            },
          },
        ],
      });

      const responseText = extractResponseText(result);

      return {
        content: [
          {
            type: "text",
            text: `LLM (with calculator tools) responded: ${responseText}`,
          },
        ],
      };
    },
  );

  // Tool that asks with weather tools
  server.registerTool(
    "ask_with_weather",
    {
      description:
        "Ask the LLM a question and provide weather tools. " +
        "The LLM can use get_weather and get_forecast tools.",
      inputSchema: z.object({
        question: z
          .string()
          .describe("A question that might need weather information"),
      }),
    },
    async (args) => {
      const { question } = args as { question: string };

      const result = await server.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `You have weather tools available. ${question}`,
            },
          },
        ],
        maxTokens: 500,
        tools: [
          {
            name: "get_weather",
            description: "Get current weather for a city",
            inputSchema: {
              type: "object" as const,
              properties: {
                city: { type: "string", description: "City name" },
              },
              required: ["city"],
            },
          },
          {
            name: "get_forecast",
            description: "Get weather forecast for the next N days",
            inputSchema: {
              type: "object" as const,
              properties: {
                city: { type: "string", description: "City name" },
                days: {
                  type: "number",
                  description: "Number of days to forecast",
                },
              },
              required: ["city", "days"],
            },
          },
        ],
      });

      const responseText = extractResponseText(result);

      return {
        content: [
          {
            type: "text",
            text: `LLM (with weather tools) responded: ${responseText}`,
          },
        ],
      };
    },
  );

  // Simple tool without sampling for verification
  server.registerTool(
    "echo",
    {
      description: "Simple echo tool for testing connectivity",
      inputSchema: z.object({
        message: z.string().describe("Message to echo back"),
      }),
    },
    async (args) => {
      const { message } = args as { message: string };
      return {
        content: [
          {
            type: "text",
            text: `Echo: ${message}`,
          },
        ],
      };
    },
  );

  // ============================================================
  // toolChoice mode tests
  // ============================================================

  // Test toolChoice.mode = "none" - tools should be filtered out
  server.registerTool(
    "ask_with_tools_disabled",
    {
      description:
        "Ask a math question with calculator tools provided, but toolChoice.mode='none'. " +
        "The LLM should NOT be able to use any tools despite them being in the request.",
      inputSchema: z.object({
        question: z.string().describe("A math question to ask"),
      }),
    },
    async (args) => {
      const { question } = args as { question: string };

      const result = await server.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `I'm providing calculator tools but they should be disabled. Please answer: ${question}`,
            },
          },
        ],
        maxTokens: 500,
        // Tools are provided but should be FILTERED OUT by the shim
        tools: [
          {
            name: "add",
            description: "Add two numbers together",
            inputSchema: {
              type: "object" as const,
              properties: {
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["a", "b"],
            },
          },
          {
            name: "multiply",
            description: "Multiply two numbers",
            inputSchema: {
              type: "object" as const,
              properties: {
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["a", "b"],
            },
          },
        ],
        // This should prevent any tools from being available!
        toolChoice: { mode: "none" },
      });

      const responseText = extractResponseText(result);

      return {
        content: [
          {
            type: "text",
            text: `LLM (toolChoice=none) responded: ${responseText}`,
          },
        ],
      };
    },
  );

  // Test toolChoice.mode = "required" - model MUST use a tool
  server.registerTool(
    "ask_must_use_tool",
    {
      description:
        "Ask a question with toolChoice.mode='required'. " +
        "The LLM MUST use at least one tool before providing a final answer.",
      inputSchema: z.object({
        question: z.string().describe("A question that requires tool use"),
      }),
    },
    async (args) => {
      const { question } = args as { question: string };

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
        maxTokens: 500,
        tools: [
          {
            name: "add",
            description: "Add two numbers together",
            inputSchema: {
              type: "object" as const,
              properties: {
                a: { type: "number", description: "First number" },
                b: { type: "number", description: "Second number" },
              },
              required: ["a", "b"],
            },
          },
          {
            name: "lookup_fact",
            description: "Look up a fact about a topic",
            inputSchema: {
              type: "object" as const,
              properties: {
                topic: { type: "string", description: "Topic to look up" },
              },
              required: ["topic"],
            },
          },
        ],
        // Model MUST use a tool - directive will be injected
        toolChoice: { mode: "required" },
      });

      const responseText = extractResponseText(result);

      return {
        content: [
          {
            type: "text",
            text: `LLM (toolChoice=required) responded: ${responseText}`,
          },
        ],
      };
    },
  );

  // Test toolChoice.mode = "auto" - explicit auto mode (should behave same as default)
  server.registerTool(
    "ask_with_auto_tools",
    {
      description:
        "Ask a question with toolChoice.mode='auto'. " +
        "The LLM can optionally use tools if helpful.",
      inputSchema: z.object({
        question: z.string().describe("A question to ask"),
      }),
    },
    async (args) => {
      const { question } = args as { question: string };

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
        maxTokens: 500,
        tools: [
          {
            name: "search",
            description: "Search for information",
            inputSchema: {
              type: "object" as const,
              properties: {
                query: { type: "string", description: "Search query" },
              },
              required: ["query"],
            },
          },
        ],
        // Explicit auto mode - should be same as not specifying toolChoice
        toolChoice: { mode: "auto" },
      });

      const responseText = extractResponseText(result);

      return {
        content: [
          {
            type: "text",
            text: `LLM (toolChoice=auto) responded: ${responseText}`,
          },
        ],
      };
    },
  );

  return server;
}

/**
 * Starts the sampling-with-tools server in HTTP mode on the specified port
 */
export async function startHttpSamplingWithToolsServer(port: number): Promise<{
  close: () => Promise<void>;
}> {
  const transports = new Map<
    string,
    WebStandardStreamableHTTPServerTransport
  >();
  const servers = new Map<string, McpServer>();

  const app = new Hono();
  app.all("/mcp", async (c) => {
    const sessionId = c.req.header("mcp-session-id");

    const rawRequest = c.req.raw;
    const bodyText = await rawRequest.text();
    let body: unknown = null;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      // Invalid JSON
    }

    const recreateRequest = () =>
      new Request(rawRequest.url, {
        method: rawRequest.method,
        headers: rawRequest.headers,
        body: bodyText || undefined,
      });

    if (!sessionId && body && isInitializeRequest(body)) {
      const newSessionId = randomUUID();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      });
      const server = createSamplingWithToolsServer();
      await server.connect(transport);

      transports.set(newSessionId, transport);
      servers.set(newSessionId, server);

      return transport.handleRequest(recreateRequest());
    }

    if (sessionId) {
      const transport = transports.get(sessionId);
      if (!transport) {
        return c.text("Session not found", 404);
      }
      return transport.handleRequest(recreateRequest());
    }

    return c.text("Bad request - missing session ID", 400);
  });

  const httpServer = serve({
    fetch: app.fetch,
    port,
    hostname: "localhost",
  });

  return {
    close: async () => {
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
 * Starts the sampling-with-tools server in stdio mode
 */
export async function startStdioSamplingWithToolsServer(): Promise<never> {
  const server = createSamplingWithToolsServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  return new Promise(() => {
    // Never resolves - keeps the process running forever
  });
}

// If this file is run directly, check for --http flag
if (process.argv[1]) {
  const { fileURLToPath } = await import("node:url");
  const currentFile = fileURLToPath(import.meta.url);
  const mainFile = process.argv[1];

  if (currentFile === mainFile) {
    const httpIndex = process.argv.indexOf("--http");
    if (httpIndex !== -1) {
      // HTTP mode: use port from args or default to 3001
      const port = parseInt(process.argv[httpIndex + 1] ?? "3001", 10);
      console.log(
        `Starting sampling-with-tools server in HTTP mode on port ${port}...`,
      );
      startHttpSamplingWithToolsServer(port)
        .then(() => {
          console.log(`Server running at http://localhost:${port}/mcp`);
        })
        .catch(console.error);
    } else {
      // Default to stdio mode
      startStdioSamplingWithToolsServer().catch(console.error);
    }
  }
}
