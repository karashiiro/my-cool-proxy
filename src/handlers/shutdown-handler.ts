import { injectable } from "inversify";
import { $inject } from "../container/decorators.js";
import type {
  ITransportManager,
  IMCPClientManager,
  ILogger,
  IShutdownHandler,
} from "../types/interfaces.js";

/**
 * Handler for graceful shutdown of the application.
 *
 * This handler orchestrates the cleanup process when the application
 * receives a shutdown signal (e.g., SIGINT). It ensures all resources
 * are properly closed before the process exits.
 *
 * Shutdown order:
 * 1. Close all transports (disconnects active MCP sessions)
 * 2. Close all client connections
 * 3. Exit the process
 *
 * Benefits of this extraction:
 * - Centralizes shutdown logic
 * - Makes testing easier (can test shutdown without process.exit)
 * - Separates concerns from index.ts
 * - Makes shutdown sequence explicit and documented
 */
@injectable()
export class ShutdownHandler implements IShutdownHandler {
  constructor(
    @$inject("TransportManager") private transportManager: ITransportManager,
    @$inject("MCPClientManager") private clientPool: IMCPClientManager,
    @$inject("Logger") private logger: ILogger,
  ) {}

  /**
   * Perform graceful shutdown.
   *
   * This method closes all transports and clients in the correct order,
   * then exits the process.
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down...");

    // Close all transports first (disconnects active sessions)
    await this.transportManager.closeAll();

    // Close all client connections
    await this.clientPool.close();

    // Gateway servers will be garbage collected when transports are destroyed
    this.logger.info("Shutdown complete");

    process.exit(0);
  }
}
