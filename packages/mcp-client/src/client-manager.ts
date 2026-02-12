import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createWriteStream, type WriteStream } from "fs";
import { getErrorMessage } from "@my-cool-proxy/mcp-utilities";
import type {
  ClientConnectionResult,
  ILogger,
  IMCPClientManager,
  ClientCapabilities,
} from "./types.js";
import type { LoggingMessageNotification } from "@modelcontextprotocol/sdk/types.js";
import { MCPClientSession } from "./client-session.js";

export class MCPClientManager implements IMCPClientManager {
  private clients = new Map<string, MCPClientSession>();
  private failedServers = new Map<string, string>(); // key -> error message
  private stderrStreams = new Map<string, WriteStream>(); // key -> stderr file stream
  private onResourceListChanged?: (
    serverName: string,
    sessionId: string,
  ) => void;
  private onPromptListChanged?: (serverName: string, sessionId: string) => void;
  private onToolListChanged?: (serverName: string, sessionId: string) => void;
  private onLoggingMessage?: (
    params: LoggingMessageNotification["params"],
    sessionId: string,
  ) => void;

  constructor(private logger: ILogger) {}

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

  setLoggingMessageHandler(
    handler: (
      params: LoggingMessageNotification["params"],
      sessionId: string,
    ) => void,
  ): void {
    this.onLoggingMessage = handler;
  }

  async addHttpClient(
    name: string,
    endpoint: string,
    sessionId: string,
    headers?: Record<string, string>,
    allowedTools?: string[],
    clientCapabilities?: ClientCapabilities,
    dangerouslyEnableSampling?: boolean,
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
      const capsToAdvertise = this.buildClientCapabilities(
        clientCapabilities,
        dangerouslyEnableSampling,
      );

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
        dangerouslyEnableSampling,
        this.onLoggingMessage
          ? (params) => this.onLoggingMessage!(params, sessionId)
          : undefined,
      );

      this.clients.set(key, wrappedClient);

      // Clear from failed servers if previously failed
      this.failedServers.delete(key);

      // Log configuration
      if (allowedTools !== undefined) {
        if (allowedTools.length === 0) {
          this.logger.warn(
            `MCP client ${name}: All tools blocked by empty allowedTools array`,
          );
        } else {
          this.logger.info(
            `MCP client ${name} configured with tool filter: ${allowedTools.join(", ")}`,
          );
        }
      }

      this.logger.info(`MCP client ${name} connected to ${endpoint}`);
      return { name, success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
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
    clientCapabilities?: ClientCapabilities,
    stderrLogPath?: string,
    dangerouslyEnableSampling?: boolean,
  ): Promise<ClientConnectionResult> {
    const key = `${name}-${sessionId}`;
    if (this.clients.has(key)) {
      this.logger.debug(
        `Client ${name} already exists for session ${sessionId}`,
      );
      return { name, success: true };
    }

    // Create stderr file stream if log path is provided
    let stderrFileStream: WriteStream | undefined;
    if (stderrLogPath) {
      stderrFileStream = createWriteStream(stderrLogPath, { flags: "w" });
    }

    try {
      // Build capabilities to advertise to the upstream server
      const capsToAdvertise = this.buildClientCapabilities(
        clientCapabilities,
        dangerouslyEnableSampling,
      );

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

      // Configure stderr handling based on whether we have a log path
      const transport = new StdioClientTransport({
        command,
        args,
        env,
        stderr: stderrLogPath ? "pipe" : "inherit",
      });

      await sdkClient.connect(transport);

      // Pipe stderr to file if configured
      if (stderrLogPath && stderrFileStream && transport.stderr) {
        transport.stderr.pipe(stderrFileStream);
        this.stderrStreams.set(key, stderrFileStream);
        this.logger.debug(
          `MCP client ${name} stderr redirected to ${stderrLogPath}`,
        );
      }

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
        dangerouslyEnableSampling,
        this.onLoggingMessage
          ? (params) => this.onLoggingMessage!(params, sessionId)
          : undefined,
      );

      this.clients.set(key, wrappedClient);

      // Clear from failed servers if previously failed
      this.failedServers.delete(key);

      // Log configuration
      if (allowedTools !== undefined) {
        if (allowedTools.length === 0) {
          this.logger.warn(
            `MCP client ${name}: All tools blocked by empty allowedTools array`,
          );
        } else {
          this.logger.info(
            `MCP client ${name} configured with tool filter: ${allowedTools.join(", ")}`,
          );
        }
      }

      this.logger.info(
        `MCP client ${name} connected to stdio process: ${command} ${args?.join(" ") || ""}`,
      );
      return { name, success: true };
    } catch (error) {
      // Clean up stderr stream on connection failure
      if (stderrFileStream) {
        stderrFileStream.end();
      }

      const errorMessage = getErrorMessage(error);
      this.logger.error(
        `Failed to connect MCP client ${name} to stdio process ${command}: ${errorMessage}`,
      );
      this.failedServers.set(key, errorMessage);
      return { name, success: false, error: errorMessage };
    }
  }

  async getClient(name: string, sessionId: string): Promise<MCPClientSession> {
    // Note: On-demand client creation is not supported. All clients must be
    // pre-connected via connectClient() before use. This ensures proper session
    // isolation and lifecycle management.
    const client = this.clients.get(`${name}-${sessionId}`);
    if (!client) {
      throw new Error(`MCP client ${name} not found for session ${sessionId}`);
    }
    return client;
  }

  getClientsBySession(sessionId: string): Map<string, MCPClientSession> {
    const sessionSuffix = `-${sessionId}`;
    return new Map(
      Array.from(this.clients.entries())
        .filter(([key]) => key.endsWith(sessionSuffix))
        .map(([key, client]) => {
          const name = key.slice(0, -sessionSuffix.length);
          return [name, client] as [string, MCPClientSession];
        }),
    );
  }

  getFailedServers(sessionId: string): Map<string, string> {
    const sessionSuffix = `-${sessionId}`;
    return new Map(
      Array.from(this.failedServers.entries())
        .filter(([key]) => key.endsWith(sessionSuffix))
        .map(([key, error]) => {
          const name = key.slice(0, -sessionSuffix.length);
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

    // Remove from clients map and close stderr streams
    for (const key of keysToDelete) {
      this.clients.delete(key);

      // Close and remove stderr stream for this client
      const stderrStream = this.stderrStreams.get(key);
      if (stderrStream) {
        stderrStream.end();
        this.stderrStreams.delete(key);
      }
    }

    // Clear failed servers for this session
    for (const key of this.failedServers.keys()) {
      if (key.endsWith(sessionSuffix)) {
        this.failedServers.delete(key);
      }
    }

    this.logger.info(`Cleaned up session ${sessionId}`);
  }

  /**
   * Build the capabilities object to advertise to upstream servers.
   * These match what the downstream client supports, so upstream servers
   * know they can send sampling/elicitation requests through the proxy.
   *
   * SECURITY: Sampling is only advertised if BOTH conditions are met:
   * 1. Downstream client supports it
   * 2. Server has dangerouslyEnableSampling=true (explicit trust)
   *
   * This prevents untrusted servers from discovering sampling capability exists.
   */
  private buildClientCapabilities(
    downstreamCaps?: ClientCapabilities,
    dangerouslyEnableSampling?: boolean,
  ): Record<string, unknown> {
    if (!downstreamCaps) {
      // No downstream capabilities known yet - don't advertise any special caps
      return {};
    }

    const caps: Record<string, unknown> = {};

    // Forward sampling capability ONLY if both:
    // 1. Downstream supports it
    // 2. This server is trusted (dangerouslyEnableSampling=true)
    if (downstreamCaps.sampling && dangerouslyEnableSampling === true) {
      caps.sampling = downstreamCaps.sampling;
      this.logger.debug(
        `Advertising sampling capability to upstream (context: ${!!downstreamCaps.sampling.context}, tools: ${!!downstreamCaps.sampling.tools})`,
      );
    } else if (downstreamCaps.sampling && !dangerouslyEnableSampling) {
      this.logger.debug(
        `Sampling capability NOT advertised - dangerouslyEnableSampling not enabled for this server`,
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

    // Close all stderr file streams
    for (const stream of this.stderrStreams.values()) {
      stream.end();
    }
    this.stderrStreams.clear();
  }
}
