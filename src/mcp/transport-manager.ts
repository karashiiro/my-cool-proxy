import { injectable } from "inversify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import type { ILogger, ITransportManager } from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";

@injectable()
export class TransportManager implements ITransportManager {
  private transports = new Map<string, StreamableHTTPServerTransport>();
  // Track the original sessionId for each transport to clean up both entries
  private transportToSessionId = new WeakMap<
    StreamableHTTPServerTransport,
    string
  >();

  constructor(@$inject("Logger") private logger: ILogger) {}

  getOrCreate(sessionId: string): StreamableHTTPServerTransport {
    if (this.transports.has(sessionId)) {
      this.logger.debug(`Reusing existing transport for session ${sessionId}`);
      return this.transports.get(sessionId)!;
    }

    this.logger.info(`Creating new transport for session ${sessionId}`);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        this.logger.info(`Transport session initialized: ${sid}`);
        this.transports.set(sid, transport);
      },
    });

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

    this.transports.set(sessionId, transport);
    return transport;
  }

  has(sessionId: string): boolean {
    return this.transports.has(sessionId);
  }

  getOrCreateForRequest(sessionId?: string): StreamableHTTPServerTransport {
    // If session ID is provided and we have an existing transport for it, reuse it
    if (sessionId && this.has(sessionId)) {
      this.logger.debug(`Reusing transport for session ${sessionId}`);
      return this.getOrCreate(sessionId);
    }

    // Otherwise, create a new transport with a unique key
    // Each new client gets its own transport, even if they don't provide a session ID
    const newSessionKey = `pending-${Date.now()}-${Math.random()}`;
    this.logger.info(`Creating new transport for new connection`);
    return this.getOrCreate(newSessionKey);
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
