import { injectable, inject } from "inversify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import type { ILogger, ITransportManager } from "../types/interfaces.js";
import { TYPES } from "../types/index.js";

@injectable()
export class TransportManager implements ITransportManager {
  private transports = new Map<string, StreamableHTTPServerTransport>();

  constructor(@inject(TYPES.Logger) private logger: ILogger) {}

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

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        this.transports.delete(sid);
        this.logger.info(`Transport session closed: ${sid}`);
      }
    };

    this.transports.set(sessionId, transport);
    return transport;
  }

  has(sessionId: string): boolean {
    return this.transports.has(sessionId);
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
