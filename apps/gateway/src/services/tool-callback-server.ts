import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import type { ILogger } from "../types/interfaces.js";

/**
 * Request body received from the sidecar when a tool is invoked.
 */
interface ToolCallbackRequest {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * Response sent back to the sidecar when a tool call is captured.
 */
interface CapturedResponse {
  status: "captured";
}

/**
 * Captured tool call data.
 * Matches the CapturedToolCall interface from @my-cool-proxy/acp-client.
 */
export interface CapturedToolCall {
  /** Unique ID for this tool use (for correlation in multi-turn flow). */
  id: string;
  /** Original tool name. */
  name: string;
  /** Tool arguments/input. */
  input: Record<string, unknown>;
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
 * mcp-sampling-sidecar and captures them instead of executing.
 *
 * This is part of the spec-compliant sampling-with-tools flow:
 * - The sidecar POSTs tool calls to this server
 * - Instead of executing, we capture the tool call details
 * - We return { status: "captured" } to stop the agent
 * - The sampling shim checks getCapturedToolCall() and returns tool_use to MCP server
 *
 * This serves as a second line of defense: most agents go through the permission
 * handler first (which captures the call). But if an agent bypasses permissions
 * and calls the sidecar directly, this callback server captures it instead.
 *
 * Created per-sampling-request and shut down after the request completes.
 */
export class ToolCallbackServer {
  private server: ServerType | null = null;
  private port: number = 0;
  private capturedToolCall: CapturedToolCall | null = null;

  constructor(private readonly logger: ILogger) {}

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

        this.logger.debug(`Tool callback received: ${tool} - capturing`);

        // SPEC-COMPLIANT: Capture the tool call instead of executing
        // The MCP server is responsible for tool execution per the spec
        this.capturedToolCall = {
          id: randomUUID(),
          name: tool,
          input: args,
        };

        // Return captured response - sidecar will handle this and return error to agent
        const response: CapturedResponse = { status: "captured" };
        return c.json(response);
      } catch (error) {
        this.logger.error(
          "Error handling tool callback",
          error instanceof Error ? error : new Error(String(error)),
        );
        // Still return captured to stop the flow - we don't want to execute anything
        const response: CapturedResponse = { status: "captured" };
        return c.json(response);
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
      // Force-close all connections immediately (Node 18.2+)
      // This prevents hanging when sidecar keeps connections open
      if ("closeAllConnections" in this.server) {
        (
          this.server as { closeAllConnections: () => void }
        ).closeAllConnections();
      }
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
      this.server = null;
    }
  }

  /**
   * Get the captured tool call, if any.
   *
   * This is the second line of defense for capturing tool calls.
   * If an agent bypasses the permission handler and calls the sidecar
   * directly, the tool call is captured here instead.
   *
   * @returns The captured tool call, or null if no tool call was captured
   */
  getCapturedToolCall(): CapturedToolCall | null {
    return this.capturedToolCall;
  }
}
