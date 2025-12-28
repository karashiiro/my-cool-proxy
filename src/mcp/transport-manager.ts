import { injectable } from "inversify";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ILogger, ITransportManager } from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";

@injectable()
export class TransportManager implements ITransportManager {
  private transports = new Map<
    string,
    WebStandardStreamableHTTPServerTransport
  >();
  // Track pending transport creations to prevent race conditions
  private pendingCreations = new Map<
    string,
    WebStandardStreamableHTTPServerTransport
  >();
  // Track the original sessionId for each transport to clean up both entries
  private transportToSessionId = new WeakMap<
    WebStandardStreamableHTTPServerTransport,
    string
  >();

  constructor(@$inject(TYPES.Logger) private logger: ILogger) {}

  getOrCreate(sessionId: string): WebStandardStreamableHTTPServerTransport {
    // Check if transport already exists
    const existingTransport = this.transports.get(sessionId);
    if (existingTransport) {
      this.logger.debug(`Reusing existing transport for session ${sessionId}`);
      return existingTransport;
    }

    // Check if transport is currently being created
    const pendingTransport = this.pendingCreations.get(sessionId);
    if (pendingTransport) {
      this.logger.debug(
        `Reusing pending transport creation for session ${sessionId}`,
      );
      return pendingTransport;
    }

    // Create transport object and add to pending IMMEDIATELY to prevent race
    // IMPORTANT: We provide a sessionIdGenerator that returns the client-provided sessionId
    // This ensures the transport uses the same session ID as the client sent in headers
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      onsessioninitialized: (sid) => {
        this.logger.info(`Transport session initialized: ${sid}`);
        this.transports.set(sid, transport);
      },
    });

    // Add to pendingCreations RIGHT AFTER creation, before ANY other operations
    this.pendingCreations.set(sessionId, transport);

    this.logger.info(`Creating new transport for session ${sessionId}`);

    // Track the original sessionId for cleanup
    this.transportToSessionId.set(transport, sessionId);

    transport.onclose = () => {
      const sid = transport.sessionId;
      const originalSessionId = this.transportToSessionId.get(transport);

      // Clean up both the generated sessionId and the original sessionId
      if (sid) {
        this.transports.delete(sid);
        this.logger.info(`Transport session closed: ${sid}`);
      }

      if (originalSessionId && originalSessionId !== sid) {
        this.transports.delete(originalSessionId);
        this.logger.info(
          `Cleaned up original session reference: ${originalSessionId}`,
        );
      }
    };

    // Store in transports map
    this.transports.set(sessionId, transport);

    // Remove from pending now that it's in the main map
    this.pendingCreations.delete(sessionId);

    return transport;
  }

  has(sessionId: string): boolean {
    return this.transports.has(sessionId);
  }

  getOrCreateForRequest(
    sessionId?: string,
  ): WebStandardStreamableHTTPServerTransport {
    // If session ID is provided and we have an existing transport for it, reuse it
    if (sessionId && this.has(sessionId)) {
      this.logger.debug(`Reusing transport for session ${sessionId}`);
      return this.getOrCreate(sessionId);
    }

    // Create a new transport
    // Use the client-provided sessionId if available, otherwise generate a pending key
    const transportKey = sessionId || `pending-${Date.now()}-${Math.random()}`;

    if (sessionId) {
      this.logger.info(`Creating new transport for session ${sessionId}`);
    } else {
      this.logger.info(`Creating new transport for new connection`);
    }

    return this.getOrCreate(transportKey);
  }

  remove(sessionId: string): void {
    const transport = this.transports.get(sessionId);
    if (transport) {
      this.transports.delete(sessionId);
      this.logger.info(`Removed transport for session ${sessionId}`);
    }
  }

  async closeAll(): Promise<void> {
    this.logger.info(`Closing all ${this.transports.size} transports...`);

    for (const [sessionId] of this.transports) {
      try {
        // Clean up the transport if needed
        this.logger.debug(`Closing transport for session ${sessionId}`);
      } catch (error) {
        this.logger.error(
          `Error closing transport for session ${sessionId}`,
          error as Error,
        );
      }
    }

    this.transports.clear();
    this.logger.info("All transports closed");
  }
}
