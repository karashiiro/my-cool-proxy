import "reflect-metadata";
import { createContainer } from "./container/inversify.config.js";
import { TYPES } from "./types/index.js";
import type {
  IMCPClientManager,
  ITransportManager,
  ILogger,
} from "./types/interfaces.js";
import { MCPGatewayServer } from "./mcp/gateway-server.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { loadConfig, mergeEnvConfig } from "./utils/config-loader.js";

// Load configuration from file and merge with environment variables
const config = mergeEnvConfig(loadConfig());

async function main() {
  const container = createContainer(config);
  const logger = container.get<ILogger>(TYPES.Logger);

  // Initialize MCP client pool
  const clientPool = container.get<IMCPClientManager>(TYPES.MCPClientManager);

  // Initialize transport manager
  const transportManager = container.get<ITransportManager>(
    TYPES.TransportManager,
  );

  // Setup Express app
  const app = createMcpExpressApp();

  // Handle all HTTP methods (POST for messages, GET for SSE, DELETE for cleanup)
  app.all("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Get or create a transport for this request
    const transport = transportManager.getOrCreateForRequest(sessionId);

    // Get the session key for client manager (use transport's sessionId once initialized)
    const clientSession = transport.sessionId || sessionId || "default";

    for (const [name, clientConfig] of Object.entries(config.mcpClients)) {
      if (clientConfig.type === "http") {
        await clientPool.addHttpClient(
          name,
          clientConfig.url,
          clientSession,
          clientConfig.headers,
          clientConfig.allowedTools,
        );
      } else if (clientConfig.type === "stdio") {
        await clientPool.addStdioClient(
          name,
          clientConfig.command,
          clientSession,
          clientConfig.args,
          clientConfig.env,
          clientConfig.allowedTools,
        );
      } else {
        // This should never happen due to config validation, but handle it for safety
        const unknownConfig = clientConfig as { type: string };
        logger.error(
          `Unsupported client type '${unknownConfig.type}' for '${name}'`,
        );
      }
    }

    // Only connect a new gateway server if this is a new transport
    // Once connected, the transport handles all subsequent requests automatically
    if (!transport.sessionId) {
      logger.info(
        `Creating new gateway server for session ${clientSession} (new transport)`,
      );
      const gatewayServer = container.get(MCPGatewayServer);
      await gatewayServer.getServer().connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  app.listen(config.port, () => {
    logger.info(
      `MCP Lua Gateway listening on http://${config.host}:${config.port}`,
    );
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    logger.info("Shutting down...");
    await transportManager.closeAll();
    await clientPool.close();
    // Gateway servers will be garbage collected when transports are destroyed
    process.exit(0);
  });
}

main().catch(console.error);
