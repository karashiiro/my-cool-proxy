import { spawn, type ChildProcess } from "child_process";
import { Readable, Writable } from "stream";
import * as acp from "@agentclientprotocol/sdk";
import type {
  ContentBlock,
  PromptCapabilities,
} from "@agentclientprotocol/sdk";
import { ACPClientSession } from "./acp-client-session.js";
import type { ACPAgentConfig, ILogger } from "./types.js";

/**
 * Content block handler function type.
 */
type ContentBlockHandler = (block: ContentBlock) => void;

/**
 * Internal ACP Client handler that implements the acp.Client interface.
 *
 * - Denies all permission requests (secure default until configurable policies are added)
 * - Dispatches sessionUpdate content blocks to registered per-session handlers
 * - Reports minimal client capabilities (no fs/terminal)
 */
class ACPClientHandler implements acp.Client {
  private contentHandlers = new Map<string, ContentBlockHandler>();

  get clientCapabilities(): acp.ClientCapabilities {
    return {};
  }

  async requestPermission(): Promise<acp.RequestPermissionResponse> {
    // Deny all permission requests. The shim agent is only used for
    // text generation (sampling), so it should not need to perform
    // privileged operations like file I/O or shell execution.
    // A configurable permission policy can be added later if needed.
    return { outcome: { outcome: "cancelled" } };
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    const update = params.update;

    if (update.sessionUpdate === "agent_message_chunk") {
      const handler = this.contentHandlers.get(params.sessionId);
      if (handler) {
        handler(update.content);
      }
    }
  }

  registerContentHandler(
    sessionId: string,
    handler: ContentBlockHandler,
  ): void {
    this.contentHandlers.set(sessionId, handler);
  }

  deregisterContentHandler(sessionId: string): void {
    this.contentHandlers.delete(sessionId);
  }
}

/**
 * Manages one ACP agent connection (one spawned process, one ClientSideConnection).
 *
 * Lifecycle:
 * 1. `connect()` - Spawns the agent process and establishes the ACP connection
 * 2. `createSession()` - Creates a new ACP session (one per sampling request)
 * 3. `close()` - Kills the agent process and cleans up
 *
 * One ACPClient instance per gateway session (long-lived).
 * One ACPClientSession per sampling request (short-lived).
 */
export class ACPClient {
  private process: ChildProcess | null = null;
  private connection: acp.ClientSideConnection | null = null;
  private handler: ACPClientHandler | null = null;
  private _promptCapabilities: PromptCapabilities = {};

  constructor(
    private readonly config: ACPAgentConfig,
    private readonly logger: ILogger,
  ) {}

  /**
   * The prompt capabilities advertised by the connected ACP agent.
   *
   * Populated after `connect()` completes. Indicates which content types
   * (image, audio, embeddedContext) the agent supports beyond the mandatory
   * text and resource_link baseline.
   */
  get promptCapabilities(): PromptCapabilities {
    return this._promptCapabilities;
  }

  /**
   * Spawn the ACP agent process and establish the connection.
   *
   * @throws Error if the process fails to spawn or the handshake fails
   */
  async connect(): Promise<void> {
    const { command, args = [], env } = this.config;

    this.logger.debug(`Spawning ACP agent: ${command} ${args.join(" ")}`);

    // Spawn the agent process
    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "inherit"],
      env: env ? { ...process.env, ...env } : undefined,
      shell: true,
    });

    // Handle process errors
    this.process.on("error", (error: Error) => {
      this.logger.error("ACP agent process error", error);
    });

    if (!this.process.stdin || !this.process.stdout) {
      throw new Error("Failed to create stdio streams for ACP agent process");
    }

    // Create the ACP transport from process stdio
    const input = Writable.toWeb(
      this.process.stdin,
    ) as WritableStream<Uint8Array>;
    const output = Readable.toWeb(
      this.process.stdout,
    ) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(input, output);

    // Create the handler and connection
    this.handler = new ACPClientHandler();
    this.connection = new acp.ClientSideConnection(() => this.handler!, stream);

    // Perform the initialization handshake
    const initResult = await this.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: this.handler.clientCapabilities,
    });

    // Capture the agent's prompt capabilities (image, audio, embeddedContext)
    this._promptCapabilities =
      initResult.agentCapabilities?.promptCapabilities ?? {};

    this.logger.info(`ACP agent connected: ${command} ${args.join(" ")}`);
  }

  /**
   * Create a new ACP session.
   *
   * @param cwd - Optional working directory for the session. Defaults to the gateway's cwd if not provided.
   * @returns An ACPClientSession that can be used to send prompts
   * @throws Error if the client is not connected
   */
  async createSession(cwd?: string): Promise<ACPClientSession> {
    if (!this.connection || !this.handler) {
      throw new Error("ACPClient is not connected. Call connect() first.");
    }

    const sessionResult = await this.connection.newSession({
      cwd: cwd ?? process.cwd(),
      mcpServers: [],
    });

    this.logger.debug(`ACP session created: ${sessionResult.sessionId}`);

    const connection = this.connection;
    const handler = this.handler;

    return new ACPClientSession(
      sessionResult.sessionId,
      // Prompt function: delegates to the connection
      async (sessionId: string, content: ContentBlock[]) => {
        return connection.prompt({ sessionId, prompt: content });
      },
      // Register handler
      (sessionId: string, contentHandler: (block: ContentBlock) => void) => {
        handler.registerContentHandler(sessionId, contentHandler);
      },
      // Deregister handler
      (sessionId: string) => {
        handler.deregisterContentHandler(sessionId);
      },
    );
  }

  /**
   * Close the ACP agent connection and kill the process.
   */
  async close(): Promise<void> {
    if (this.process) {
      this.logger.debug("Closing ACP agent process");
      this.process.kill();
      this.process = null;
    }

    this.connection = null;
    this.handler = null;
  }
}
