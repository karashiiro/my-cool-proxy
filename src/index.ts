import "reflect-metadata";
import { createContainer } from "./container/inversify.config.js";
import { TYPES } from "./types/index.js";
import type {
  ILogger,
  IMCPSessionController,
  IShutdownHandler,
} from "./types/interfaces.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { loadConfig, mergeEnvConfig } from "./utils/config-loader.js";

// Load configuration from file and merge with environment variables
const config = mergeEnvConfig(loadConfig());

async function main() {
  const container = createContainer(config);
  const logger = container.get<ILogger>(TYPES.Logger);

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

main().catch(console.error);
