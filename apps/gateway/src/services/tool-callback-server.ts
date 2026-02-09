import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { createServer } from "node:net";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { IMCPClientManager, ILogger } from "../types/interfaces.js";

/**
 * Request body received from the sidecar when a tool is invoked.
 */
interface ToolCallbackRequest {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * Allocates an available port by creating a temporary server on port 0.
 */
async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.listen(0, () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to get port from server address"));
        return;
      }

      const port = address.port;

      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve(port);
        }
      });
    });

    server.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Ephemeral HTTP server that receives tool execution requests from the
 * mcp-sampling-sidecar and routes them to the appropriate upstream MCP server.
 *
 * Created per-sampling-request and shut down after the request completes.
 */
export class ToolCallbackServer {
  private server: ServerType | null = null;
  private port: number = 0;

  constructor(
    private readonly clientManager: IMCPClientManager,
    private readonly sessionId: string,
    private readonly logger: ILogger,
  ) {}

  /**
   * Start the HTTP callback server on an available port.
   * @returns The callback URL (e.g., "http://localhost:12345")
   */
  async start(): Promise<string> {
    this.port = await allocatePort();

    const app = new Hono();

    app.post("/execute", async (c) => {
      try {
        const body = await c.req.json<ToolCallbackRequest>();
        const { tool, args } = body;

        this.logger.debug(`Tool callback: ${tool}`);

        // Find the tool in our connected MCP servers
        const clients = this.clientManager.getClientsBySession(this.sessionId);

        for (const [serverName, client] of clients) {
          try {
            const tools = await client.listTools();
            const matchingTool = tools.find((t) => t.name === tool);

            if (matchingTool) {
              this.logger.debug(`Routing tool ${tool} to ${serverName}`);
              const result = await client.callTool({
                name: tool,
                arguments: args,
              });
              return c.json(result as CallToolResult);
            }
          } catch (error) {
            this.logger.debug(
              `Error checking server ${serverName} for tool ${tool}: ${error instanceof Error ? error.message : String(error)}`,
            );
            // Continue to next server
          }
        }

        // Tool not found in any server
        const errorResult: CallToolResult = {
          isError: true,
          content: [
            {
              type: "text",
              text: `Tool "${tool}" not found in any connected MCP server`,
            },
          ],
        };
        return c.json(errorResult, 404);
      } catch (error) {
        this.logger.error(
          "Error handling tool callback",
          error instanceof Error ? error : new Error(String(error)),
        );
        const errorResult: CallToolResult = {
          isError: true,
          content: [
            {
              type: "text",
              text: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
        return c.json(errorResult, 500);
      }
    });

    const callbackUrl = await new Promise<string>((resolve) => {
      this.server = serve(
        {
          fetch: app.fetch,
          port: this.port,
          hostname: "127.0.0.1",
        },
        (info) => {
          // Server is ready and listening
          const url = `http://${info.address}:${info.port}`;
          this.logger.debug(`Tool callback server started at ${url}`);
          resolve(url);
        },
      );
    });

    return callbackUrl;
  }

  /**
   * Stop the HTTP callback server.
   */
  async stop(): Promise<void> {
    if (this.server) {
      this.logger.debug(`Stopping tool callback server on port ${this.port}`);
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
      this.server = null;
    }
  }
}
