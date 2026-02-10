import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  isInitializeRequest,
  type CreateMessageRequest,
  type CreateMessageResult,
  type SamplingMessage,
  type Tool,
  type TextContent,
  type ToolResultContent,
  type ToolUseContent,
} from "@modelcontextprotocol/sdk/types.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as z from "zod";
import { randomUUID } from "node:crypto";

// Maximum number of tool call rounds to prevent infinite loops
const MAX_TOOL_ROUNDS = 10;

/**
 * Type guard for tool_use content blocks.
 */
function isToolUseContent(content: unknown): content is ToolUseContent {
  return (
    typeof content === "object" &&
    content !== null &&
    "type" in content &&
    content.type === "tool_use"
  );
}

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
 * Tool executor function type.
 * Takes tool name and input, returns the result as a string.
 */
type ToolExecutor = (
  toolName: string,
  input: Record<string, unknown>,
) => string;

/**
 * Execute a multi-turn sampling request with tools.
 *
 * SPEC-COMPLIANT: Per the MCP sampling-with-tools spec, when the gateway returns
 * a tool_use response (stopReason === "toolUse"), the SERVER is responsible for:
 * 1. Executing the tool locally
 * 2. Sending a follow-up sampling request with the tool_result appended
 * 3. Continuing until stopReason !== "toolUse"
 *
 * @param server The MCP server instance
 * @param initialMessages Initial conversation messages
 * @param tools Tools to provide in the sampling request
 * @param executeToolLocally Function to execute tools locally
 * @param maxTokens Maximum tokens for the response
 * @param toolChoice Optional tool choice configuration
 * @returns The final text response from the LLM
 */
async function executeMultiTurnSampling(
  server: McpServer,
  initialMessages: SamplingMessage[],
  tools: Tool[],
  executeToolLocally: ToolExecutor,
  maxTokens: number = 500,
  toolChoice?: CreateMessageRequest["params"]["toolChoice"],
): Promise<string> {
  const messages = [...initialMessages];
  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    // Send sampling request
    const result = (await server.server.createMessage({
      messages,
      maxTokens,
      tools,
      toolChoice,
    })) as CreateMessageResult & { stopReason?: string };

    // Check if we got a tool_use response
    if (result.stopReason === "toolUse") {
      // Find the tool_use content block
      const contentArray = Array.isArray(result.content)
        ? result.content
        : [result.content];

      const toolUseBlock = contentArray.find(isToolUseContent);

      if (!toolUseBlock) {
        // stopReason is toolUse but no tool_use block found - shouldn't happen
        return `Error: stopReason is toolUse but no tool_use content found. Content: ${JSON.stringify(result.content)}`;
      }

      // Execute the tool locally
      const toolResult = executeToolLocally(
        toolUseBlock.name,
        toolUseBlock.input as Record<string, unknown>,
      );

      // Append assistant message with tool_use
      messages.push({
        role: "assistant",
        content: toolUseBlock,
      });

      // Append user message with tool_result
      const toolResultContent: ToolResultContent = {
        type: "tool_result",
        toolUseId: toolUseBlock.id,
        content: [{ type: "text", text: toolResult }],
      };

      messages.push({
        role: "user",
        content: toolResultContent,
      });

      // Continue the loop for the next round
      continue;
    }

    // Not a tool_use - we have the final response
    return extractResponseText(result);
  }

  return `Error: Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS})`;
}

/**
 * Calculator tool executor.
 * Implements add, subtract, multiply, divide operations.
 */
function executeCalculatorTool(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const a = Number(input.a);
  const b = Number(input.b);

  switch (toolName) {
    case "add":
      return String(a + b);
    case "subtract":
      return String(a - b);
    case "multiply":
      return String(a * b);
    case "divide":
      if (b === 0) return "Error: Division by zero";
      return String(a / b);
    default:
      return `Unknown calculator tool: ${toolName}`;
  }
}

/**
 * Weather tool executor.
 * Returns mock weather data.
 */
function executeWeatherTool(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const city = String(input.city || "Unknown");

  switch (toolName) {
    case "get_weather":
      return `Current weather in ${city}: Sunny, 72°F (22°C), humidity 45%`;
    case "get_forecast": {
      const days = Number(input.days || 3);
      return `${days}-day forecast for ${city}: Day 1: Sunny 75°F, Day 2: Partly cloudy 70°F, Day 3: Rain 65°F`;
    }
    default:
      return `Unknown weather tool: ${toolName}`;
  }
}

/**
 * Generic tool executor for testing.
 * Handles add, lookup_fact, search tools.
 */
function executeGenericTool(
  toolName: string,
  input: Record<string, unknown>,
): string {
  switch (toolName) {
    case "add": {
      const a = Number(input.a);
      const b = Number(input.b);
      return String(a + b);
    }
    case "lookup_fact": {
      const topic = String(input.topic || "unknown");
      return `Fact about ${topic}: This is a mock fact for testing purposes.`;
    }
    case "search": {
      const query = String(input.query || "");
      return `Search results for "${query}": Found 3 relevant results about ${query}.`;
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
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

  // Calculator tools definition (reused across multiple tool handlers)
  const calculatorTools: Tool[] = [
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
  ];

  // Tool that triggers a sampling request with calculator tools available
  // Uses SPEC-COMPLIANT multi-turn flow
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

      const initialMessages: SamplingMessage[] = [
        {
          role: "user",
          content: {
            type: "text",
            text: `You have access to calculator tools. Please solve: ${question}`,
          } as TextContent,
        },
      ];

      // SPEC-COMPLIANT: Use multi-turn flow
      // Gateway returns tool_use, we execute locally, send follow-up with result
      const responseText = await executeMultiTurnSampling(
        server,
        initialMessages,
        calculatorTools,
        executeCalculatorTool,
      );

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

  // Weather tools definition
  const weatherTools: Tool[] = [
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
  ];

  // Tool that asks with weather tools
  // Uses SPEC-COMPLIANT multi-turn flow
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

      const initialMessages: SamplingMessage[] = [
        {
          role: "user",
          content: {
            type: "text",
            text: `You have weather tools available. ${question}`,
          } as TextContent,
        },
      ];

      // SPEC-COMPLIANT: Use multi-turn flow
      const responseText = await executeMultiTurnSampling(
        server,
        initialMessages,
        weatherTools,
        executeWeatherTool,
      );

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
  // This does NOT use multi-turn because tools are disabled
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

      // toolChoice.mode = "none" means tools are disabled
      // The shim should filter them out and NOT return tool_use
      // So we use single-turn (no multi-turn loop needed)
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

  // Tools for "required" mode test
  const requiredModeTools: Tool[] = [
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
  ];

  // Test toolChoice.mode = "required" - model MUST use a tool
  // Uses SPEC-COMPLIANT multi-turn flow
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

      const initialMessages: SamplingMessage[] = [
        {
          role: "user",
          content: {
            type: "text",
            text: question,
          } as TextContent,
        },
      ];

      // SPEC-COMPLIANT: Use multi-turn flow with required tool choice
      const responseText = await executeMultiTurnSampling(
        server,
        initialMessages,
        requiredModeTools,
        executeGenericTool,
        500,
        { mode: "required" },
      );

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

  // Tools for "auto" mode test
  const autoModeTools: Tool[] = [
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
  ];

  // Test toolChoice.mode = "auto" - explicit auto mode (should behave same as default)
  // Uses SPEC-COMPLIANT multi-turn flow
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

      const initialMessages: SamplingMessage[] = [
        {
          role: "user",
          content: {
            type: "text",
            text: question,
          } as TextContent,
        },
      ];

      // SPEC-COMPLIANT: Use multi-turn flow with auto tool choice
      const responseText = await executeMultiTurnSampling(
        server,
        initialMessages,
        autoModeTools,
        executeGenericTool,
        500,
        { mode: "auto" },
      );

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

  // ============================================================
  // Filesystem capability tests
  // ============================================================

  // Test reading a file in the working directory
  server.registerTool(
    "ask_to_read_file",
    {
      description:
        "Ask the LLM to read a file using the ACP client's filesystem capabilities. " +
        "The ACP agent must support fs/read_text_file and the gateway must have " +
        "acp.filesystem.readTextFile enabled.",
      inputSchema: z.object({
        filename: z
          .string()
          .describe("Filename to read (relative to working directory)"),
      }),
    },
    async (args) => {
      const { filename } = args as { filename: string };

      const result = await server.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Please read the file "${filename}" from the current working directory ` +
                `and tell me what it contains. Use the filesystem read capability.`,
            },
          },
        ],
        maxTokens: 1000,
      });

      const responseText = extractResponseText(result);

      return {
        content: [
          {
            type: "text",
            text: `LLM (fs read test) responded: ${responseText}`,
          },
        ],
      };
    },
  );

  // Test writing a file in the working directory
  server.registerTool(
    "ask_to_write_file",
    {
      description:
        "Ask the LLM to write content to a file using the ACP client's filesystem capabilities. " +
        "The ACP agent must support fs/write_text_file and the gateway must have " +
        "acp.filesystem.writeTextFile enabled.",
      inputSchema: z.object({
        filename: z
          .string()
          .describe("Filename to write (relative to working directory)"),
        content: z.string().describe("Content to write to the file"),
      }),
    },
    async (args) => {
      const { filename, content } = args as {
        filename: string;
        content: string;
      };

      const result = await server.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Please write the following content to a file named "${filename}" ` +
                `in the current working directory:\n\n${content}\n\n` +
                `Use the filesystem write capability.`,
            },
          },
        ],
        maxTokens: 500,
      });

      const responseText = extractResponseText(result);

      return {
        content: [
          {
            type: "text",
            text: `LLM (fs write test) responded: ${responseText}`,
          },
        ],
      };
    },
  );

  // Test write then read in the SAME session (same working directory)
  server.registerTool(
    "ask_to_write_then_read",
    {
      description:
        "Ask the LLM to write content to a file, then read it back in the SAME session. " +
        "This tests that the filesystem capabilities work correctly within a single session's working directory.",
      inputSchema: z.object({
        filename: z
          .string()
          .describe(
            "Filename to write and read (relative to working directory)",
          ),
        content: z.string().describe("Content to write to the file"),
      }),
    },
    async (args) => {
      const { filename, content } = args as {
        filename: string;
        content: string;
      };

      const result = await server.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Please do the following in order:\n` +
                `1. Write this content to a file named "${filename}": "${content}"\n` +
                `2. Read the file back and tell me what it contains\n` +
                `3. Confirm the content matches what was written\n\n` +
                `Use the filesystem read and write capabilities for both operations.`,
            },
          },
        ],
        maxTokens: 1000,
      });

      const responseText = extractResponseText(result);

      return {
        content: [
          {
            type: "text",
            text: `LLM (fs write+read test) responded: ${responseText}`,
          },
        ],
      };
    },
  );

  // Test attempting to read outside sandbox (should fail)
  server.registerTool(
    "ask_to_read_outside_sandbox",
    {
      description:
        "Ask the LLM to read a file outside the sandbox (like /etc/passwd). " +
        "This should FAIL with a sandbox violation error if security is working correctly.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute path outside sandbox (e.g., /etc/passwd)"),
      }),
    },
    async (args) => {
      const { path } = args as { path: string };

      const result = await server.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Please try to read the file at "${path}" using the filesystem read capability. ` +
                `Report what happens - whether you can read it or if you get an error.`,
            },
          },
        ],
        maxTokens: 500,
      });

      const responseText = extractResponseText(result);

      return {
        content: [
          {
            type: "text",
            text: `LLM (sandbox escape test) responded: ${responseText}`,
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
