import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serveStdio } from "@karashiiro/mcp/stdio";
import { serveHttp } from "@karashiiro/mcp/http";
import * as z from "zod";

/**
 * Creates a roots tester MCP server that calls listRoots on the downstream client
 */
function createRootsTesterServer(): McpServer {
  const server = new McpServer(
    {
      name: "roots-tester",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Register tool that calls listRoots on the downstream client
  server.registerTool(
    "call-list-roots",
    {
      description:
        "Calls listRoots() on the downstream client to get its root URIs",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        // Call listRoots on the connected client
        const rootsResult = await server.server.listRoots();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(rootsResult, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Error calling listRoots: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

/**
 * Starts the roots tester server in HTTP mode on the specified port
 */
export async function startHttpRootsTesterServer(port: number) {
  return serveHttp(() => createRootsTesterServer(), {
    port,
    host: "localhost",
    endpoint: "/mcp",
    sessions: {}, // Enable stateful sessions
  });
}

/**
 * Starts the roots tester server in stdio mode (for use as child process)
 */
export async function startStdioRootsTesterServer() {
  return serveStdio(() => createRootsTesterServer());
}

// If this file is run directly, check for --http flag
if (process.argv[1]) {
  const { fileURLToPath } = await import("node:url");
  const currentFile = fileURLToPath(import.meta.url);
  const mainFile = process.argv[1];

  if (currentFile === mainFile) {
    const httpIndex = process.argv.indexOf("--http");
    if (httpIndex !== -1) {
      // HTTP mode: use port from args or default to 3005
      const port = parseInt(process.argv[httpIndex + 1] ?? "3005", 10);
      console.log(`Starting roots tester in HTTP mode on port ${port}...`);
      await startHttpRootsTesterServer(port);
      console.log(`Server running at http://localhost:${port}/mcp`);
    } else {
      // Default to stdio mode
      await startStdioRootsTesterServer();
    }
  }
}
