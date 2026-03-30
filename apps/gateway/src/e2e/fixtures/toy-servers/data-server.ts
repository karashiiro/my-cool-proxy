import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serveStdio } from "@karashiiro/mcp/stdio";
import { serveHttp } from "@karashiiro/mcp/http";
import * as z from "zod";

// Sample data for resources
const testData = {
  users: [
    { id: 1, name: "Alice", role: "admin" },
    { id: 2, name: "Bob", role: "user" },
    { id: 3, name: "Charlie", role: "user" },
  ],
  config: {
    debug: true,
    maxConnections: 100,
  },
};

const configYaml = `# Application Configuration
server:
  port: 8080
  host: localhost

database:
  type: postgresql
  host: db.example.com
  port: 5432
`;

const fileContents: Record<string, string> = {
  "test-data.json": JSON.stringify(testData, null, 2),
  "config.yaml": configYaml,
};

/**
 * Creates a data server MCP server with resources, tools, and prompts
 */
function createDataServer(): McpServer {
  const server = new McpServer(
    {
      name: "data-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
      },
    },
  );

  // Register tools
  server.registerTool(
    "list-files",
    {
      description: "List all available files",
      inputSchema: z.object({}),
    },
    async () => {
      const files = Object.keys(fileContents);
      return {
        content: [
          {
            type: "text",
            text: `Available files:\n${files.map((f) => "- file://" + f).join("\n")}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "read-file",
    {
      description: "Read the contents of a file",
      inputSchema: z.object({
        filename: z
          .string()
          .describe("Filename to read (e.g., 'test-data.json')"),
      }),
    },
    async (args) => {
      const { filename } = args as { filename: string };

      if (fileContents[filename]) {
        return {
          content: [
            {
              type: "text",
              text: fileContents[filename],
            },
          ],
        };
      }

      throw new Error(`File not found: ${filename}`);
    },
  );

  // Register prompts
  server.registerPrompt(
    "data-analysis",
    {
      description: "Analyze the sample data",
      argsSchema: {
        focus: z.string().optional().describe("What aspect to focus on"),
      },
    },
    async (args) => {
      const focus = (args?.focus as string) || "all data";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please analyze the sample data with focus on: ${focus}\n\nData: ${fileContents["test-data.json"]}`,
            },
          },
        ],
      };
    },
  );

  // Register resources
  const testDataCallback: ReadResourceCallback = async (uri) => {
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: fileContents["test-data.json"] ?? "",
        },
      ],
    };
  };
  server.resource("test-data", "file:///test-data.json", testDataCallback);

  const configCallback: ReadResourceCallback = async (uri) => {
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "text/yaml",
          text: fileContents["config.yaml"] ?? "",
        },
      ],
    };
  };
  server.resource("config", "file:///config.yaml", configCallback);

  return server;
}

/**
 * Starts the data server in HTTP mode on the specified port
 */
export async function startHttpDataServer(port: number) {
  return serveHttp(() => createDataServer(), {
    port,
    host: "localhost",
    endpoint: "/mcp",
    sessions: {},
  });
}

/**
 * Starts the data server in stdio mode (for use as child process)
 */
export async function startStdioDataServer() {
  return serveStdio(() => createDataServer());
}

// If this file is run directly, start in stdio mode
if (process.argv[1]) {
  const { fileURLToPath } = await import("node:url");
  const currentFile = fileURLToPath(import.meta.url);
  const mainFile = process.argv[1];

  if (currentFile === mainFile) {
    await startStdioDataServer();
  }
}
