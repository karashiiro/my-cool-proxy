import { injectable, inject } from "inversify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ILogger, IMCPClientManager } from "../types/interfaces.js";
import { TYPES } from "../types/index.js";

@injectable()
export class MCPClientManager implements IMCPClientManager {
  private clients = new Map<string, Client>();

  constructor(@inject(TYPES.Logger) private logger: ILogger) {}

  async addClient(
    name: string,
    endpoint: string,
    sessionId: string,
  ): Promise<void> {
    if (this.clients.has(name)) {
      this.logger.debug(`Client ${name} already exists`);
      return;
    }

    const client = new Client(
      {
        name: "my-cool-proxy",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    const transport = new StreamableHTTPClientTransport(new URL(endpoint));
    await client.connect(transport);

    this.clients.set(`${name}-${sessionId}`, client);

    this.logger.info(`MCP client ${name} connected to ${endpoint}`);
  }

  async getClient(name: string, sessionId: string): Promise<Client> {
    // TODO: Support creating sessionless clients on-demand
    const client = this.clients.get(`${name}-${sessionId}`);
    if (!client) {
      throw new Error(`MCP client ${name} not found for session ${sessionId}`);
    }
    return client;
  }

  getClientsBySession(sessionId: string): Map<string, Client> {
    return new Map(
      Array.from(this.clients.entries())
        .filter(([key]) => key.endsWith(`-${sessionId}`))
        .map(([key, client]) => {
          const name = key.split(`-${sessionId}`)[0];
          return [name, client] as [string, Client];
        }),
    );
  }

  async close(): Promise<void> {
    for (const [name, client] of this.clients) {
      await client.close();
      this.logger.info(`Closed MCP client ${name}`);
    }
  }
}
