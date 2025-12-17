import "reflect-metadata";
import { createContainer } from "./container/inversify.config.js";
import { TYPES } from "./types/index.js";
import type {
  ILuaRuntime,
  IMCPClientManager,
  ILogger,
  ServerConfig,
} from "./types/interfaces.js";
import { MCPGatewayServer } from "./mcp/gateway-server.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";

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

  // Create gateway server
  const gatewayServer = new MCPGatewayServer(luaRuntime, clientPool, logger);

  // Setup Express app
  const app = createMcpExpressApp();
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    for (const { name, endpoint } of config.mcpClients) {
      await clientPool.addClient(name, endpoint, sessionId || "default");
    }

    // TODO: Create transport manager
    let transport: StreamableHTTPServerTransport;
    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          logger.info(`Session initialized: ${sid}`);
          transports.set(sid, transport);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) transports.delete(sid);
        // TODO: Clean up MCP clients for this session
        logger.info(`Session closed: ${sid}`);
      };

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
    await clientPool.close();
    await luaRuntime.close();
    process.exit(0);
  });
}

main().catch(console.error);
