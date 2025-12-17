import "reflect-metadata";
import { createContainer } from "./container/inversify.config.js";
import { TYPES } from "./types/index.js";
import type {
  ILuaRuntime,
  IMCPClientManager,
  ITransportManager,
  ILogger,
  ServerConfig,
} from "./types/interfaces.js";
import { MCPGatewayServer } from "./mcp/gateway-server.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";

const config: ServerConfig = {
  port: parseInt(process.env.PORT || "3000"),
  host: process.env.HOST || "localhost",
  useOAuth: process.env.USE_OAUTH === "true",
  mcpClients: [
    { name: "mcp-docs", endpoint: "https://modelcontextprotocol.io/mcp" },
  ],
};

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

    for (const { name, endpoint } of config.mcpClients) {
      await clientPool.addClient(name, endpoint, sessionId || "default");
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
    await luaRuntime.close();
    process.exit(0);
  });
}

main().catch(console.error);
