import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

/**
 * Creates an MCP server that writes to stderr for testing stderr logging.
 * This server intentionally outputs messages to stderr on startup and
 * when its tool is called.
 */
function createStderrServer(): McpServer {
  const server = new McpServer(
    {
      name: "stderr-test-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Tool that writes to stderr
  server.registerTool(
    "write_to_stderr",
    {
      description: "Write a message to stderr for testing",
      inputSchema: z.object({
        message: z.string().describe("Message to write to stderr"),
      }),
    },
    async (args) => {
      const { message } = args as { message: string };

      // Write to stderr
      process.stderr.write(`[stderr-test] Tool called: ${message}\n`);

      return {
        content: [
          {
            type: "text",
            text: `Wrote to stderr: ${message}`,
          },
        ],
      };
    },
  );

  // Simple echo tool for verifying server is working
  server.registerTool(
    "echo",
    {
      description: "Echo back the input message",
      inputSchema: z.object({
        message: z.string().describe("Message to echo"),
      }),
    },
    async (args) => {
      const { message } = args as { message: string };
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
      };
    },
  );

  return server;
}

/**
 * Starts the stderr test server in stdio mode.
 * Writes to stderr on startup to verify logging is captured.
 */
export async function startStdioStderrServer(): Promise<never> {
  // Write startup message to stderr
  process.stderr.write("[stderr-test] Server starting up...\n");

  const server = createStderrServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Write ready message to stderr
  process.stderr.write(
    "[stderr-test] Server ready and accepting connections\n",
  );

  // Handle shutdown signals
  const handleShutdown = () => {
    process.stderr.write(
      "[stderr-test] Server shutting down (received signal)\n",
    );
    process.exit(0);
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);

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
    startStdioStderrServer().catch(console.error);
  }
}
