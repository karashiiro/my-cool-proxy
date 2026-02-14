import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serveStdio } from "@karashiiro/mcp/stdio";
import { serveHttp } from "@karashiiro/mcp/http";
import * as z from "zod";

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
export async function startHttpCalculatorServer(port: number) {
  return serveHttp(() => createCalculatorServer(), {
    port,
    host: "localhost",
    endpoint: "/mcp",
    sessions: {},
  });
}

/**
 * Starts the calculator server in stdio mode (for use as child process)
 */
export async function startStdioCalculatorServer() {
  return serveStdio(() => createCalculatorServer());
}

// If this file is run directly, check for --http flag
if (process.argv[1]) {
  const { fileURLToPath } = await import("node:url");
  const currentFile = fileURLToPath(import.meta.url);
  const mainFile = process.argv[1];

  if (currentFile === mainFile) {
    const httpIndex = process.argv.indexOf("--http");
    if (httpIndex !== -1) {
      // HTTP mode: use port from args or default to 3002
      const port = parseInt(process.argv[httpIndex + 1] ?? "3002", 10);
      console.log(`Starting calculator server in HTTP mode on port ${port}...`);
      await startHttpCalculatorServer(port);
      console.log(`Server running at http://localhost:${port}/mcp`);
    } else {
      // Default to stdio mode
      await startStdioCalculatorServer();
    }
  }
}
