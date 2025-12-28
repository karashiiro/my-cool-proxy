import "reflect-metadata";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createContainer } from "../../container/inversify.config.js";
import { TYPES } from "../../types/index.js";
import type {
  ILogger,
  IMCPSessionController,
  IMCPClientManager,
  ServerConfig,
} from "../../types/interfaces.js";

export class HttpServerManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private server: any = null;
  private clientManager: IMCPClientManager | null = null;

  /**
   * Starts the HTTP gateway server with the provided configuration.
   *
   * @param config - Server configuration
   */
  async start(config: ServerConfig): Promise<void> {
    if (this.server) {
      throw new Error("Server is already running");
    }

    if (!config.port || !config.host) {
      throw new Error("Port and host are required for HTTP mode");
    }

    // Create DI container
    const container = createContainer(config);

    const logger = container.get<ILogger>(TYPES.Logger);
    const sessionController = container.get<IMCPSessionController>(
      TYPES.MCPSessionController,
    );

    // Store client manager for cleanup
    this.clientManager = container.get<IMCPClientManager>(
      TYPES.MCPClientManager,
    );

    // Setup Hono app (same as src/index.ts)
    const app = new Hono();

    // Enable CORS for MCP protocol
    app.use(
      "*",
      cors({
        origin: "*",
        allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
        allowHeaders: [
          "Content-Type",
          "mcp-session-id",
          "Last-Event-ID",
          "mcp-protocol-version",
        ],
        exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
      }),
    );

    // MCP endpoint
    app.all("/mcp", async (c) => {
      return await sessionController.handleRequest(c.req.raw);
    });

    // Start the server
    this.server = serve({
      fetch: app.fetch,
      port: config.port,
      hostname: config.host,
    });

    logger.info(
      `Test MCP Gateway started on http://${config.host}:${config.port}`,
    );

    // Wait for server to be ready
    await this.waitForReady(config.host, config.port);
  }

  /**
   * Stops the HTTP gateway server.
   */
  async stop(): Promise<void> {
    if (this.clientManager) {
      await this.clientManager.close();
      this.clientManager = null;
    }

    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err: Error | undefined) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      this.server = null;
    }
  }

  /**
   * Waits for the server to be ready by checking if the port is listening.
   */
  private async waitForReady(
    host: string,
    port: number,
    timeoutMs = 5000,
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Try to connect to the server - just check if port is open
        const net = await import("node:net");
        const socket = new net.Socket();

        await new Promise<void>((resolve, reject) => {
          socket.setTimeout(1000);
          socket.once("connect", () => {
            socket.destroy();
            resolve();
          });
          socket.once("timeout", () => {
            socket.destroy();
            reject(new Error("Timeout"));
          });
          socket.once("error", (err) => {
            reject(err);
          });
          socket.connect(port, host);
        });

        // Server is ready
        return;
      } catch {
        // Server not ready yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    throw new Error(`Server did not become ready within ${timeoutMs}ms`);
  }
}
