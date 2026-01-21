import { injectable } from "inversify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  ClientConnectionResult,
  ILogger,
  IMCPClientManager,
  DownstreamCapabilities,
} from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import { MCPClientSession } from "./client-session.js";

@injectable()
export class MCPClientManager implements IMCPClientManager {
  private clients = new Map<string, MCPClientSession>();
  private failedServers = new Map<string, string>(); // key -> error message
  private onResourceListChanged?: (
    serverName: string,
    sessionId: string,
  ) => void;
  private onPromptListChanged?: (serverName: string, sessionId: string) => void;
  private onToolListChanged?: (serverName: string, sessionId: string) => void;

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

  setToolListChangedHandler(
    handler: (serverName: string, sessionId: string) => void,
  ): void {
    this.onToolListChanged = handler;
  }

  async addHttpClient(
    name: string,
    endpoint: string,
    sessionId: string,
    headers?: Record<string, string>,
    allowedTools?: string[],
    clientCapabilities?: DownstreamCapabilities,
  ): Promise<ClientConnectionResult> {
    const key = `${name}-${sessionId}`;
    if (this.clients.has(key)) {
      this.logger.debug(
        `Client ${name} already exists for session ${sessionId}`,
      );
      return { name, success: true };
    }

    try {
      // Build capabilities to advertise to the upstream server
      // These should match what the downstream client supports, so upstream
      // servers know they can send sampling/elicitation requests through us
      const capsToAdvertise = this.buildClientCapabilities(clientCapabilities);

      // Create underlying SDK client
      const sdkClient = new Client(
        {
          name: "my-cool-proxy",
          version: "1.0.0",
        },
        {
          capabilities: capsToAdvertise,
          enforceStrictCapabilities: true,
        },
      );

      // NOTE: We do NOT propagate session IDs to upstream servers.
      // Each upstream MCP server connection goes through its own fresh initialization
      // and gets its own session ID from that server. The gateway's internal session ID
      // is only for tracking which gateway session owns which upstream client connections.
      const allHeaders = {
        ...headers,
      };

      const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit:
          Object.keys(allHeaders).length > 0
            ? { headers: allHeaders }
            : undefined,
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
        this.onToolListChanged
          ? (serverName) => this.onToolListChanged!(serverName, sessionId)
          : undefined,
      );

      this.clients.set(key, wrappedClient);

      // Clear from failed servers if previously failed
      this.failedServers.delete(key);

      // Log configuration
      if (allowedTools !== undefined) {
        this.logger.info(
          `MCP client ${name} configured with tool filter: ${allowedTools.length === 0 ? "all tools blocked" : allowedTools.join(", ")}`,
        );
      }

      this.logger.info(`MCP client ${name} connected to ${endpoint}`);
      return { name, success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to connect MCP client ${name} to ${endpoint}: ${errorMessage}`,
      );
      this.failedServers.set(key, errorMessage);
      return { name, success: false, error: errorMessage };
    }
  }

  async addStdioClient(
    name: string,
    command: string,
    sessionId: string,
    args?: string[],
    env?: Record<string, string>,
    allowedTools?: string[],
    clientCapabilities?: DownstreamCapabilities,
  ): Promise<ClientConnectionResult> {
    const key = `${name}-${sessionId}`;
    if (this.clients.has(key)) {
      this.logger.debug(
        `Client ${name} already exists for session ${sessionId}`,
      );
      return { name, success: true };
    }

    try {
      // Build capabilities to advertise to the upstream server
      const capsToAdvertise = this.buildClientCapabilities(clientCapabilities);

      // Create underlying SDK client
      const sdkClient = new Client(
        {
          name: "my-cool-proxy",
          version: "1.0.0",
        },
        {
          capabilities: capsToAdvertise,
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
        this.onToolListChanged
          ? (serverName) => this.onToolListChanged!(serverName, sessionId)
          : undefined,
      );

      this.clients.set(key, wrappedClient);

      // Clear from failed servers if previously failed
      this.failedServers.delete(key);

      // Log configuration
      if (allowedTools !== undefined) {
        this.logger.info(
          `MCP client ${name} configured with tool filter: ${allowedTools.length === 0 ? "all tools blocked" : allowedTools.join(", ")}`,
        );
      }

      this.logger.info(
        `MCP client ${name} connected to stdio process: ${command} ${args?.join(" ") || ""}`,
      );
      return { name, success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to connect MCP client ${name} to stdio process ${command}: ${errorMessage}`,
      );
      this.failedServers.set(key, errorMessage);
      return { name, success: false, error: errorMessage };
    }
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

  getFailedServers(sessionId: string): Map<string, string> {
    return new Map(
      Array.from(this.failedServers.entries())
        .filter(([key]) => key.endsWith(`-${sessionId}`))
        .map(([key, error]) => {
          const name = key.split(`-${sessionId}`)[0];
          return [name, error] as [string, string];
        }),
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    // Close all clients for this session
    const sessionSuffix = `-${sessionId}`;
    const keysToDelete: string[] = [];

    for (const [key, client] of this.clients) {
      if (key.endsWith(sessionSuffix)) {
        await client.close();
        this.logger.info(`Closed MCP client ${key}`);
        keysToDelete.push(key);
      }
    }

    // Remove from clients map
    for (const key of keysToDelete) {
      this.clients.delete(key);
    }

    // Clear failed servers for this session
    for (const key of this.failedServers.keys()) {
      if (key.endsWith(sessionSuffix)) {
        this.failedServers.delete(key);
      }
    }

    this.logger.debug(`Cleaned up session ${sessionId}`);
  }

  /**
   * Build the capabilities object to advertise to upstream servers.
   * These match what the downstream client supports, so upstream servers
   * know they can send sampling/elicitation requests through the proxy.
   */
  private buildClientCapabilities(
    downstreamCaps?: DownstreamCapabilities,
  ): Record<string, unknown> {
    if (!downstreamCaps) {
      // No downstream capabilities known yet - don't advertise any special caps
      return {};
    }

    const caps: Record<string, unknown> = {};

    // Forward sampling capability if downstream supports it
    if (downstreamCaps.sampling) {
      caps.sampling = downstreamCaps.sampling;
      this.logger.debug(
        `Advertising sampling capability to upstream (context: ${!!downstreamCaps.sampling.context}, tools: ${!!downstreamCaps.sampling.tools})`,
      );
    }

    // Forward elicitation capability if downstream supports it
    if (downstreamCaps.elicitation) {
      caps.elicitation = downstreamCaps.elicitation;
      this.logger.debug(
        `Advertising elicitation capability to upstream (form: ${!!downstreamCaps.elicitation.form}, url: ${!!downstreamCaps.elicitation.url})`,
      );
    }

    return caps;
  }

  async close(): Promise<void> {
    for (const [name, client] of this.clients) {
      await client.close();
      this.logger.info(`Closed MCP client ${name}`);
    }
    this.clients.clear();
    this.failedServers.clear();
  }
}
