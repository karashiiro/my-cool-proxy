import { injectable } from "inversify";
import type {
  ICapabilityStore,
  DownstreamCapabilities,
  ILogger,
} from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";

/**
 * In-memory store for tracking downstream client capabilities per session.
 * Used to determine what capabilities to advertise to upstream MCP servers.
 * Also tracks working directories for spawning ACP agents.
 */
@injectable()
export class CapabilityStore implements ICapabilityStore {
  private capabilities = new Map<string, DownstreamCapabilities>();
  private workingDirectories = new Map<string, string>();

  constructor(@$inject(TYPES.Logger) private logger: ILogger) {}

  setCapabilities(sessionId: string, caps: DownstreamCapabilities): void {
    this.capabilities.set(sessionId, caps);
    this.logger.debug(
      `Stored capabilities for session ${sessionId}: sampling=${!!caps.sampling}, elicitation=${!!caps.elicitation}`,
    );
  }

  getCapabilities(sessionId: string): DownstreamCapabilities | undefined {
    return this.capabilities.get(sessionId);
  }

  hasCapability(
    sessionId: string,
    capability: "sampling" | "elicitation",
  ): boolean {
    const caps = this.capabilities.get(sessionId);
    if (!caps) return false;
    return !!caps[capability];
  }

  hasElicitationMode(sessionId: string, mode: "form" | "url"): boolean {
    const caps = this.capabilities.get(sessionId);
    if (!caps?.elicitation) return false;
    return !!caps.elicitation[mode];
  }

  deleteCapabilities(sessionId: string): void {
    this.capabilities.delete(sessionId);
    this.workingDirectories.delete(sessionId);
    this.logger.debug(`Removed capabilities for session ${sessionId}`);
  }

  /**
   * Store the validated working directory for a session.
   * This is either a valid local root from the client, or a tempdir.
   */
  setWorkingDirectory(sessionId: string, cwd: string): void {
    this.workingDirectories.set(sessionId, cwd);
    this.logger.debug(`Set working directory for session ${sessionId}: ${cwd}`);
  }

  /**
   * Get the working directory for a session.
   * Returns undefined if not set.
   */
  getWorkingDirectory(sessionId: string): string | undefined {
    return this.workingDirectories.get(sessionId);
  }
}
