import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { serveStdio } from "@karashiiro/mcp/stdio";
import { serveHttp } from "@karashiiro/mcp/http";
import * as z from "zod";

// Sample data for completions
const languages = [
  "typescript",
  "javascript",
  "python",
  "rust",
  "go",
  "java",
  "csharp",
  "ruby",
  "swift",
  "kotlin",
];

const frameworks: Record<string, string[]> = {
  typescript: ["express", "fastify", "nestjs", "hono"],
  javascript: ["express", "fastify", "koa", "hapi"],
  python: ["django", "flask", "fastapi", "starlette"],
  rust: ["actix-web", "axum", "rocket", "warp"],
  go: ["gin", "echo", "fiber", "chi"],
  java: ["spring", "quarkus", "micronaut", "vert.x"],
  csharp: ["aspnet", "minimal-api", "carter", "servicestack"],
  ruby: ["rails", "sinatra", "hanami", "roda"],
  swift: ["vapor", "hummingbird", "kitura", "perfect"],
  kotlin: ["ktor", "spring", "http4k", "javalin"],
};

const regions = ["us-east-1", "us-west-2", "eu-west-1", "ap-northeast-1"];

const services: Record<string, string[]> = {
  "us-east-1": ["api-gateway", "auth-service", "user-service", "billing"],
  "us-west-2": ["api-gateway", "search-service", "ml-pipeline"],
  "eu-west-1": ["api-gateway", "auth-service", "gdpr-service"],
  "ap-northeast-1": ["api-gateway", "localization-service"],
};

/**
 * Creates a completions MCP server that exposes prompt and resource template completions
 */
function createCompletionsServer(): McpServer {
  const server = new McpServer(
    {
      name: "completions-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
        completions: {},
      },
    },
  );

  // --- Prompt with completable arguments ---

  server.registerPrompt(
    "code-review",
    {
      description:
        "Generate a code review prompt for a given language and framework",
      argsSchema: {
        language: completable(
          z.string().describe("Programming language"),
          async (value) => {
            return languages.filter((lang) =>
              lang.startsWith(value.toLowerCase()),
            );
          },
        ),
        framework: completable(
          z.string().describe("Framework to review"),
          async (value, context) => {
            // Use context to filter frameworks based on selected language
            const lang = context?.arguments?.language;
            const available = lang
              ? (frameworks[lang] ?? [])
              : Object.values(frameworks).flat();
            return available.filter((fw) => fw.startsWith(value.toLowerCase()));
          },
        ),
      },
    },
    async (args) => {
      const { language, framework } = args as {
        language: string;
        framework: string;
      };
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Please review this ${framework} (${language}) code for best practices, security issues, and performance.`,
            },
          },
        ],
      };
    },
  );

  // --- Resource template with completion callbacks ---

  const deploymentTemplate = new ResourceTemplate(
    "deployment://{region}/{service}",
    {
      list: async () => {
        // List all known deployments
        const resources = [];
        for (const [region, svcs] of Object.entries(services)) {
          for (const svc of svcs) {
            resources.push({
              uri: `deployment://${region}/${svc}`,
              name: `${svc} (${region})`,
            });
          }
        }
        return { resources };
      },
      complete: {
        region: async (value) => {
          return regions.filter((r) => r.startsWith(value.toLowerCase()));
        },
        service: async (value, context) => {
          const region = context?.arguments?.region;
          const available = region
            ? (services[region] ?? [])
            : [...new Set(Object.values(services).flat())];
          return available.filter((s) => s.startsWith(value.toLowerCase()));
        },
      },
    },
  );

  server.registerResource(
    "deployment",
    deploymentTemplate,
    {
      description: "Deployment configuration for a service in a region",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const region = variables.region as string;
      const service = variables.service as string;
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(
              {
                region,
                service,
                status: "healthy",
                replicas: 3,
                version: "2.1.0",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // --- Simple tool to verify the server is running ---

  server.registerTool(
    "echo",
    {
      description: "Echo back the input",
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
            text: `echo: ${message}`,
          },
        ],
      };
    },
  );

  return server;
}

/**
 * Starts the completions server in HTTP mode on the specified port
 */
export async function startHttpCompletionsServer(port: number) {
  return serveHttp(() => createCompletionsServer(), {
    port,
    host: "localhost",
    endpoint: "/mcp",
    sessions: {},
  });
}

/**
 * Starts the completions server in stdio mode (for use as child process)
 */
export async function startStdioCompletionsServer() {
  return serveStdio(() => createCompletionsServer());
}

// If this file is run directly, check for --http flag
if (process.argv[1]) {
  const { fileURLToPath } = await import("node:url");
  const currentFile = fileURLToPath(import.meta.url);
  const mainFile = process.argv[1];

  if (currentFile === mainFile) {
    const httpIndex = process.argv.indexOf("--http");
    if (httpIndex !== -1) {
      // HTTP mode: use port from args or default to 3010
      const port = parseInt(process.argv[httpIndex + 1] ?? "3010", 10);
      console.log(
        `Starting completions server in HTTP mode on port ${port}...`,
      );
      await startHttpCompletionsServer(port);
      console.log(`Server running at http://localhost:${port}/mcp`);
    } else {
      // Default to stdio mode
      await startStdioCompletionsServer();
    }
  }
}
