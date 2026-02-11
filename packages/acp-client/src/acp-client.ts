import { spawn, type ChildProcess } from "child_process";
import { Readable, Writable } from "stream";
import { readFile, writeFile } from "fs/promises";
import * as acp from "@agentclientprotocol/sdk";
import type {
  ContentBlock,
  McpServer,
  PromptCapabilities,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk";
import { ACPClientSession } from "./acp-client-session.js";
import {
  sandboxPathForRead,
  sandboxPathForWrite,
  PathSandboxError,
} from "./path-sandbox.js";
import type {
  ACPAgentConfig,
  AllowOwnToolsConfig,
  FilesystemConfig,
  ILogger,
  WorkingDirectoryLookup,
} from "./types.js";

/**
 * Content block handler function type.
 */
type ContentBlockHandler = (block: ContentBlock) => void;

/**
 * Options for configuring the ACPClientHandler.
 */
interface ACPClientHandlerOptions {
  /** Filesystem capabilities configuration. */
  filesystem?: FilesystemConfig;
  /** Function to look up working directory for a session. */
  getWorkingDirectory?: WorkingDirectoryLookup;
  /** Logger for sandbox violations and errors. */
  logger: ILogger;
  /** Configuration for auto-approving tool calls by kind. */
  allowOwnTools?: AllowOwnToolsConfig;
}

/**
 * Internal ACP Client handler that implements the acp.Client interface.
 *
 * - APPROVES permission requests for sidecar tools (identified by session tag)
 * - Denies all other permission requests (secure default)
 * - Dispatches sessionUpdate content blocks to registered per-session handlers
 * - Handles filesystem requests when enabled (sandboxed to session working directory)
 *
 * For spec-compliant sampling-with-tools:
 * When an agent requests permission for a sidecar tool, we approve it so the agent
 * can call the tool. The tool call is then captured by the callback server (which
 * receives the full arguments), not the permission handler (which lacks args).
 */
class ACPClientHandler implements acp.Client {
  private contentHandlers = new Map<string, ContentBlockHandler>();
  private sessionToolTags = new Map<string, string>();
  private readonly fsConfig: FilesystemConfig;
  private readonly getWorkingDirectory: WorkingDirectoryLookup;
  private readonly logger: ILogger;
  private readonly allowOwnTools?: AllowOwnToolsConfig;

  constructor(options: ACPClientHandlerOptions) {
    this.fsConfig = options.filesystem ?? {
      readTextFile: false,
      writeTextFile: false,
    };
    this.getWorkingDirectory = options.getWorkingDirectory ?? (() => undefined);
    this.logger = options.logger;
    this.allowOwnTools = options.allowOwnTools;

    this.logger.debug(
      `ACPClientHandler initialized with fs capabilities: read=${this.fsConfig.readTextFile}, write=${this.fsConfig.writeTextFile}`,
    );
  }

  get clientCapabilities(): acp.ClientCapabilities {
    // Only advertise fs capabilities if at least one is enabled
    if (this.fsConfig.readTextFile || this.fsConfig.writeTextFile) {
      const caps = {
        fs: {
          readTextFile: this.fsConfig.readTextFile,
          writeTextFile: this.fsConfig.writeTextFile,
        },
      };
      this.logger.debug(
        `Advertising ACP client capabilities: ${JSON.stringify(caps)}`,
      );
      return caps;
    }
    return {};
  }

  async requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const { sessionId, toolCall, options } = params;

    this.logger.debug(
      `Permission request: tool="${toolCall.title}" kind=${toolCall.kind ?? "undefined"} session=${sessionId}`,
    );

    // Check if this session has a tool tag registered
    const toolTag = this.sessionToolTags.get(sessionId);

    // Helper to find and select an allow option
    const selectAllowOption = (): acp.RequestPermissionResponse | undefined => {
      const allowOption = options.find(
        (o) => o.kind === "allow_once" || o.kind === "allow_always",
      );
      if (allowOption) {
        return {
          outcome: { outcome: "selected", optionId: allowOption.optionId },
        };
      }
      return undefined;
    };

    // 1. Check dangerouslyAllowAll first (supersedes everything)
    if (this.allowOwnTools?.dangerouslyAllowAll) {
      this.logger.warn(
        `Permission AUTO-APPROVED (dangerouslyAllowAll) for "${toolCall.title}" (session=${sessionId})`,
      );
      const result = selectAllowOption();
      if (result) return result;
      // Fall through if no allow option available
    }

    // 2. Check toolKinds match
    if (
      toolCall.kind &&
      this.allowOwnTools?.toolKinds?.includes(toolCall.kind)
    ) {
      this.logger.info(
        `Permission APPROVED (toolKind=${toolCall.kind}) for "${toolCall.title}" (session=${sessionId})`,
      );
      const result = selectAllowOption();
      if (result) return result;
      // Fall through if no allow option available
    }

    // 3. Existing toolTag matching - If we have a tool tag, check if the tool title contains it
    // This is robust to any prefixing scheme the agent uses
    if (toolTag && toolCall.title && toolCall.title.includes(toolTag)) {
      // APPROVE the permission request so the agent can call the sidecar.
      // The sidecar will POST to the callback server, which captures the
      // tool call WITH ARGUMENTS (the permission request doesn't include args).
      // The callback server returns "captured" status, causing the sidecar
      // to return an error to the agent, which stops execution.
      const result = selectAllowOption();
      if (result) {
        this.logger.info(
          `Permission APPROVED (toolTag) for "${toolCall.title}" (session=${sessionId})`,
        );
        return result;
      }

      // If no allow option, fall back to denying
      this.logger.warn(
        `Permission DENIED for sidecar tool "${toolCall.title}" - no allow option available`,
      );
      return { outcome: { outcome: "cancelled" } };
    }

    // 4. Deny all other permission requests. The shim agent is only used for
    // text generation (sampling), so it should not need to perform
    // privileged operations like file I/O or shell execution.
    this.logger.info(
      `Permission DENIED for tool "${toolCall.title}" (session=${sessionId})`,
    );
    return { outcome: { outcome: "cancelled" } };
  }

  /**
   * Register a tool tag for a session.
   * Tool calls with titles containing this tag will be auto-approved.
   */
  registerToolTag(sessionId: string, tag: string): void {
    this.sessionToolTags.set(sessionId, tag);
  }

  /**
   * Deregister the tool tag for a session.
   */
  deregisterToolTag(sessionId: string): void {
    this.sessionToolTags.delete(sessionId);
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

  /**
   * Handle extension notifications from the agent.
   * Silently ignores unknown notification types (e.g., custom agent notifications).
   */
  extNotification: acp.Client["extNotification"] = async () => {
    // Silently ignore - we don't need to handle custom agent notifications
  };

  /**
   * Read a text file from the session's working directory.
   * Only available when `fs.readTextFile` capability is enabled.
   *
   * Security: All paths are sandboxed to the session's working directory.
   * Symlinks are resolved and validated to prevent escape attacks.
   */
  async readTextFile(
    params: ReadTextFileRequest,
  ): Promise<ReadTextFileResponse> {
    this.logger.info(
      `fs/read_text_file called: path="${params.path}" session=${params.sessionId}`,
    );

    // Check if capability is enabled
    if (!this.fsConfig.readTextFile) {
      this.logger.warn(`fs/read_text_file rejected: capability not enabled`);
      throw acp.RequestError.methodNotFound("fs/read_text_file");
    }

    // Get the working directory for this session
    const sandbox = this.getWorkingDirectory(params.sessionId);
    if (!sandbox) {
      this.logger.warn(
        `fs/read_text_file rejected: no working directory for session ${params.sessionId}`,
      );
      throw acp.RequestError.invalidParams(
        undefined,
        "Unknown session or working directory not initialized",
      );
    }

    this.logger.debug(`fs/read_text_file sandbox: ${sandbox}`);

    // Validate and sandbox the path
    let resolvedPath: string;
    try {
      resolvedPath = await sandboxPathForRead(params.path, sandbox);
    } catch (error) {
      if (error instanceof PathSandboxError) {
        this.logger.warn(
          `Sandbox violation in readTextFile: ${error.message} (session=${params.sessionId})`,
        );
        throw acp.RequestError.invalidParams(undefined, error.message);
      }
      throw error;
    }

    this.logger.debug(`fs/read_text_file resolved path: ${resolvedPath}`);

    // Read the file
    try {
      let content = await readFile(resolvedPath, "utf-8");

      // Handle line/limit parameters
      if (params.line !== undefined || params.limit !== undefined) {
        const lines = content.split("\n");
        const startLine = params.line ? params.line - 1 : 0; // Convert to 0-based
        const endLine = params.limit ? startLine + params.limit : lines.length;
        content = lines.slice(startLine, endLine).join("\n");
      }

      this.logger.info(
        `fs/read_text_file success: read ${content.length} chars from ${params.path}`,
      );
      return { content };
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        this.logger.warn(`fs/read_text_file: file not found: ${params.path}`);
        throw acp.RequestError.resourceNotFound(params.path);
      }
      throw error;
    }
  }

  /**
   * Write a text file to the session's working directory.
   * Only available when `fs.writeTextFile` capability is enabled.
   *
   * Security: All paths are sandboxed to the session's working directory.
   * Parent directory must exist and be within the sandbox.
   */
  async writeTextFile(
    params: WriteTextFileRequest,
  ): Promise<WriteTextFileResponse> {
    this.logger.info(
      `fs/write_text_file called: path="${params.path}" session=${params.sessionId} (${params.content.length} chars)`,
    );

    // Check if capability is enabled
    if (!this.fsConfig.writeTextFile) {
      this.logger.warn(`fs/write_text_file rejected: capability not enabled`);
      throw acp.RequestError.methodNotFound("fs/write_text_file");
    }

    // Get the working directory for this session
    const sandbox = this.getWorkingDirectory(params.sessionId);
    if (!sandbox) {
      this.logger.warn(
        `fs/write_text_file rejected: no working directory for session ${params.sessionId}`,
      );
      throw acp.RequestError.invalidParams(
        undefined,
        "Unknown session or working directory not initialized",
      );
    }

    this.logger.debug(`fs/write_text_file sandbox: ${sandbox}`);

    // Validate and sandbox the path
    let resolvedPath: string;
    try {
      resolvedPath = await sandboxPathForWrite(params.path, sandbox);
    } catch (error) {
      if (error instanceof PathSandboxError) {
        this.logger.warn(
          `Sandbox violation in writeTextFile: ${error.message} (session=${params.sessionId})`,
        );
        throw acp.RequestError.invalidParams(undefined, error.message);
      }
      throw error;
    }

    this.logger.debug(`fs/write_text_file resolved path: ${resolvedPath}`);

    // Write the file
    await writeFile(resolvedPath, params.content, "utf-8");

    this.logger.info(
      `fs/write_text_file success: wrote ${params.content.length} chars to ${params.path}`,
    );
    return {};
  }
}

/**
 * Options for creating an ACPClient.
 */
export interface ACPClientOptions {
  /** ACP agent configuration (command, args, env). */
  config: ACPAgentConfig;
  /** Logger instance. */
  logger: ILogger;
  /** Optional filesystem capabilities configuration. */
  filesystem?: FilesystemConfig;
  /** Optional function to look up working directory for a session. */
  getWorkingDirectory?: WorkingDirectoryLookup;
  /** Optional configuration for auto-approving tool calls by kind. */
  allowOwnTools?: AllowOwnToolsConfig;
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
  private readonly config: ACPAgentConfig;
  private readonly logger: ILogger;
  private readonly filesystemConfig?: FilesystemConfig;
  private readonly getWorkingDirectory?: WorkingDirectoryLookup;
  private readonly allowOwnToolsConfig?: AllowOwnToolsConfig;

  constructor(options: ACPClientOptions) {
    this.config = options.config;
    this.logger = options.logger;
    this.filesystemConfig = options.filesystem;
    this.getWorkingDirectory = options.getWorkingDirectory;
    this.allowOwnToolsConfig = options.allowOwnTools;
  }

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
    this.handler = new ACPClientHandler({
      filesystem: this.filesystemConfig,
      getWorkingDirectory: this.getWorkingDirectory,
      logger: this.logger,
      allowOwnTools: this.allowOwnToolsConfig,
    });
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
   * @param mcpServers - Optional list of MCP servers to connect to for this session.
   *                     Stdio transport is always supported (per ACP spec), HTTP/SSE require capability checks.
   * @param toolTag - Optional unique tag for auto-approving tool permission requests.
   *                  If provided, any tool whose title contains this tag will be auto-approved.
   * @returns An ACPClientSession that can be used to send prompts
   * @throws Error if the client is not connected
   */
  async createSession(
    cwd?: string,
    mcpServers?: McpServer[],
    toolTag?: string,
  ): Promise<ACPClientSession> {
    if (!this.connection || !this.handler) {
      throw new Error("ACPClient is not connected. Call connect() first.");
    }

    const sessionResult = await this.connection.newSession({
      cwd: cwd ?? process.cwd(),
      mcpServers: mcpServers ?? [],
    });

    this.logger.debug(`ACP session created: ${sessionResult.sessionId}`);

    // Register tool tag for this session (for auto-approving permission requests)
    if (toolTag) {
      this.handler.registerToolTag(sessionResult.sessionId, toolTag);
      this.logger.debug(
        `Registered tool tag "${toolTag}" for session ${sessionResult.sessionId}`,
      );
    }

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
      // Deregister handler (also cleans up tool tag)
      (sessionId: string) => {
        handler.deregisterContentHandler(sessionId);
        handler.deregisterToolTag(sessionId);
      },
    );
  }

  /**
   * Close the ACP agent connection and kill the process.
   */
  async close(): Promise<void> {
    if (this.process) {
      this.logger.debug("Closing ACP agent process");
      const proc = this.process;
      this.process = null;

      // Wait for process to exit with timeout
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if SIGTERM didn't work
          proc.kill("SIGKILL");
          resolve();
        }, 2000);

        proc.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });

        proc.kill("SIGTERM");
      });
    }

    this.connection = null;
    this.handler = null;
  }
}
