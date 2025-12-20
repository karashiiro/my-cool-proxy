import "reflect-metadata";
import type { Container } from "inversify";
import { createContainer } from "./container/inversify.config.js";
import { TYPES } from "./types/index.js";
import type {
  ILogger,
  IMCPSessionController,
  IMCPClientManager,
  IShutdownHandler,
  ServerConfig,
} from "./types/interfaces.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, mergeEnvConfig } from "./utils/config-loader.js";
import type { MCPGatewayServer } from "./mcp/gateway-server.js";

// Load configuration from file and merge with environment variables
const config = mergeEnvConfig(loadConfig());

async function startHttpMode(container: Container, config: ServerConfig) {
  const logger = container.get<ILogger>(TYPES.Logger);

  // Ensure port and host are defined (validation should guarantee this)
  if (config.port === undefined || config.host === undefined) {
    throw new Error("Port and host are required for HTTP mode");
  }

  // Get session controller from DI container
  const sessionController = container.get<IMCPSessionController>(
    TYPES.MCPSessionController,
  );

  // Get shutdown handler from DI container
  const shutdownHandler = container.get<IShutdownHandler>(
    TYPES.ShutdownHandler,
  );

  // Setup Express app
  const app = createMcpExpressApp();

  // Handle all HTTP methods (POST for messages, GET for SSE, DELETE for cleanup)
  app.all("/mcp", async (req, res) => {
    await sessionController.handleRequest(req, res);
  });

  app.listen(config.port, () => {
    logger.info(
      `MCP Lua Gateway listening on http://${config.host}:${config.port}`,
    );
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    void shutdownHandler.shutdown();
  });
}

async function startStdioMode(container: Container, config: ServerConfig) {
  const logger = container.get<ILogger>(TYPES.Logger);
  const gatewayServer = container.get<MCPGatewayServer>(TYPES.MCPGatewayServer);
  const clientManager = container.get<IMCPClientManager>(
    TYPES.MCPClientManager,
  );

  // Fixed session ID for stdio (single session mode)
  // Use "default" to match what StdioServerTransport provides in tool context
  const SESSION_ID = "default";

  // Initialize all configured MCP clients upfront
  for (const [name, clientConfig] of Object.entries(config.mcpClients)) {
    if (clientConfig.type === "http") {
      await clientManager.addHttpClient(
        name,
        clientConfig.url,
        SESSION_ID,
        clientConfig.headers,
        clientConfig.allowedTools,
      );
    } else if (clientConfig.type === "stdio") {
      await clientManager.addStdioClient(
        name,
        clientConfig.command,
        SESSION_ID,
        clientConfig.args,
        clientConfig.env,
        clientConfig.allowedTools,
      );
    }
  }

  // Create and connect stdio transport
  // Note: connect() automatically calls start() for us
  const transport = new StdioServerTransport();
  await gatewayServer.getServer().connect(transport);

  logger.info("MCP Lua Gateway running in stdio mode");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await clientManager.close();
    logger.info("Shutdown complete");
    process.exit(0);
  });
}

async function main() {
  const container = createContainer(config);

  // Route to appropriate mode based on transport config
  if (config.transport === "stdio") {
    await startStdioMode(container, config);
  } else {
    // Default to HTTP mode
    await startHttpMode(container, config);
  }
}

main().catch(console.error);
