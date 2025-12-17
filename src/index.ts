import "reflect-metadata";
import { createContainer } from "./container/inversify.config.js";
import { TYPES } from "./types/index.js";
import type {
  ILuaRuntime,
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

  // Initialize Lua runtime with MCP bridge
  const luaRuntime = container.get<ILuaRuntime>(TYPES.LuaRuntime);

  // Initialize transport manager
  const transportManager = container.get<ITransportManager>(
    TYPES.TransportManager,
  );

  // Create gateway server
  const gatewayServer = new MCPGatewayServer(luaRuntime, clientPool, logger);

  // Setup Express app
  const app = createMcpExpressApp();

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    for (const [name, clientConfig] of Object.entries(config.mcpClients)) {
      if (clientConfig.type === "http") {
        await clientPool.addHttpClient(
          name,
          clientConfig.url,
          sessionId || "default",
        );
      } else if (clientConfig.type === "stdio") {
        await clientPool.addStdioClient(
          name,
          clientConfig.command,
          sessionId || "default",
          clientConfig.args,
          clientConfig.env,
        );
      } else {
        // This should never happen due to config validation, but handle it for safety
        const unknownConfig = clientConfig as { type: string };
        logger.error(
          `Unsupported client type '${unknownConfig.type}' for '${name}'`,
        );
      }
    }

    const transport = transportManager.getOrCreate(sessionId || "default");

    // Only connect if this is a new transport
    if (!transport.sessionId) {
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
    process.exit(0);
  });
}

main().catch(console.error);
