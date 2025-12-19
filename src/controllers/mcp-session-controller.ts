import { injectable, inject } from "inversify";
import type { Request, Response } from "express";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { TYPES } from "../types/index.js";
import type {
  IMCPClientManager,
  ITransportManager,
  ILogger,
  ServerConfig,
  IMCPSessionController,
} from "../types/interfaces.js";
import type { MCPGatewayServer } from "../mcp/gateway-server.js";

/**
 * Controller that handles MCP session management and request routing.
 *
 * This controller orchestrates the business logic for handling MCP requests:
 * - Session ID extraction and transport management
 * - Client initialization for sessions
 * - Gateway server creation and connection
 * - Request delegation to the appropriate transport
 *
 * Benefits of this extraction:
 * - Separates HTTP concerns from business logic
 * - Easier to test (no need to spin up HTTP server)
 * - Centralizes session management logic
 * - Makes index.ts a clean composition root
 */
@injectable()
export class MCPSessionController implements IMCPSessionController {
  constructor(
    @inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @inject(TYPES.TransportManager) private transportManager: ITransportManager,
    @inject(TYPES.MCPGatewayServer) private gatewayServer: MCPGatewayServer,
    @inject(TYPES.ServerConfig) private config: ServerConfig,
    @inject(TYPES.Logger) private logger: ILogger,
  ) {}

  /**
   * Handle an incoming MCP request.
   *
   * This method:
   * 1. Extracts session ID from request headers
   * 2. Gets or creates transport for the session
   * 3. Initializes MCP clients for the session
   * 4. Connects gateway server if this is a new transport
   * 5. Delegates request handling to the transport
   */
  async handleRequest(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Get or create transport for this request
    const transport = this.transportManager.getOrCreateForRequest(sessionId);

    // Get the session key for client manager (use transport's sessionId once initialized)
    const clientSession = transport.sessionId || sessionId || "default";

    // Initialize clients for this session if needed
    await this.initializeClientsForSession(clientSession);

    // Connect gateway server if this is a new transport
    // Once connected, the transport handles all subsequent requests automatically
    if (!transport.sessionId) {
      await this.connectGatewayServer(transport, clientSession);
    }

    // Handle the request through the transport
    await transport.handleRequest(req, res, req.body);
  }

  /**
   * Initialize all configured MCP clients for a session.
   *
   * This iterates through the server configuration and creates HTTP or stdio
   * clients as needed. Clients are idempotent - if a client already exists
   * for the session, it won't be recreated.
   */
  private async initializeClientsForSession(sessionId: string): Promise<void> {
    for (const [name, clientConfig] of Object.entries(this.config.mcpClients)) {
      if (clientConfig.type === "http") {
        await this.clientPool.addHttpClient(
          name,
          clientConfig.url,
          sessionId,
          clientConfig.headers,
          clientConfig.allowedTools,
        );
      } else if (clientConfig.type === "stdio") {
        await this.clientPool.addStdioClient(
          name,
          clientConfig.command,
          sessionId,
          clientConfig.args,
          clientConfig.env,
          clientConfig.allowedTools,
        );
      } else {
        // This should never happen due to config validation, but handle it for safety
        const unknownConfig = clientConfig as { type: string };
        this.logger.error(
          `Unsupported client type '${unknownConfig.type}' for '${name}'`,
        );
      }
    }
  }

  /**
   * Connect the gateway server to a new transport.
   *
   * This creates the connection between the gateway server and the transport,
   * enabling the transport to handle incoming requests through the gateway.
   */
  private async connectGatewayServer(
    transport: StreamableHTTPServerTransport,
    sessionId: string,
  ): Promise<void> {
    this.logger.info(
      `Creating new gateway server for session ${sessionId} (new transport)`,
    );

    await this.gatewayServer.getServer().connect(transport);
  }
}
