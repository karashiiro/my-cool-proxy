import { injectable } from "inversify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ILogger, IMCPClientManager } from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import { MCPClientSession } from "./client-session.js";

@injectable()
export class MCPClientManager implements IMCPClientManager {
  private clients = new Map<string, MCPClientSession>();
  private onResourceListChanged?: (
    serverName: string,
    sessionId: string,
  ) => void;
  private onPromptListChanged?: (serverName: string, sessionId: string) => void;

  constructor(@$inject(TYPES.Logger) private logger: ILogger) {}

  setResourceListChangedHandler(
    handler: (serverName: string, sessionId: string) => void,
  ): void {
    this.onResourceListChanged = handler;
  }

  setPromptListChangedHandler(
    handler: (serverName: string, sessionId: string) => void,
  ): void {
    this.onPromptListChanged = handler;
  }

  async addHttpClient(
    name: string,
    endpoint: string,
    sessionId: string,
    headers?: Record<string, string>,
    allowedTools?: string[],
  ): Promise<void> {
    const key = `${name}-${sessionId}`;
    if (this.clients.has(key)) {
      this.logger.debug(
        `Client ${name} already exists for session ${sessionId}`,
      );
      return;
    }

    // Create underlying SDK client
    const sdkClient = new Client(
      {
        name: "my-cool-proxy",
        version: "1.0.0",
      },
      {
        capabilities: {},
        enforceStrictCapabilities: true,
      },
    );

    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: headers ? { headers } : undefined,
    });
    await sdkClient.connect(transport);

    // Wrap in MCPClientSession
    const wrappedClient = new MCPClientSession(
      sdkClient,
      name,
      allowedTools,
      this.logger,
      this.onResourceListChanged
        ? (serverName) => this.onResourceListChanged!(serverName, sessionId)
        : undefined,
      this.onPromptListChanged
        ? (serverName) => this.onPromptListChanged!(serverName, sessionId)
        : undefined,
    );

    this.clients.set(key, wrappedClient);

    // Log configuration
    if (allowedTools !== undefined) {
      this.logger.info(
        `MCP client ${name} configured with tool filter: ${allowedTools.length === 0 ? "all tools blocked" : allowedTools.join(", ")}`,
      );
    }

    this.logger.info(`MCP client ${name} connected to ${endpoint}`);
  }

  async addStdioClient(
    name: string,
    command: string,
    sessionId: string,
    args?: string[],
    env?: Record<string, string>,
    allowedTools?: string[],
  ): Promise<void> {
    const key = `${name}-${sessionId}`;
    if (this.clients.has(key)) {
      this.logger.debug(
        `Client ${name} already exists for session ${sessionId}`,
      );
      return;
    }

    // Create underlying SDK client
    const sdkClient = new Client(
      {
        name: "my-cool-proxy",
        version: "1.0.0",
      },
      {
        capabilities: {},
        enforceStrictCapabilities: true,
      },
    );

    const transport = new StdioClientTransport({
      command,
      args,
      env,
    });

    await sdkClient.connect(transport);

    // Wrap in MCPClientSession
    const wrappedClient = new MCPClientSession(
      sdkClient,
      name,
      allowedTools,
      this.logger,
      this.onResourceListChanged
        ? (serverName) => this.onResourceListChanged!(serverName, sessionId)
        : undefined,
      this.onPromptListChanged
        ? (serverName) => this.onPromptListChanged!(serverName, sessionId)
        : undefined,
    );

    this.clients.set(key, wrappedClient);

    // Log configuration
    if (allowedTools !== undefined) {
      this.logger.info(
        `MCP client ${name} configured with tool filter: ${allowedTools.length === 0 ? "all tools blocked" : allowedTools.join(", ")}`,
      );
    }

    this.logger.info(
      `MCP client ${name} connected to stdio process: ${command} ${args?.join(" ") || ""}`,
    );
  }

  async getClient(name: string, sessionId: string): Promise<MCPClientSession> {
    // TODO: Support creating sessionless clients on-demand
    const client = this.clients.get(`${name}-${sessionId}`);
    if (!client) {
      throw new Error(`MCP client ${name} not found for session ${sessionId}`);
    }
    return client;
  }

  getClientsBySession(sessionId: string): Map<string, MCPClientSession> {
    return new Map(
      Array.from(this.clients.entries())
        .filter(([key]) => key.endsWith(`-${sessionId}`))
        .map(([key, client]) => {
          const name = key.split(`-${sessionId}`)[0];
          return [name, client] as [string, MCPClientSession];
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
