import { injectable } from "inversify";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type {
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
 * Note: Transport/server closing is handled by the @karashiiro/mcp library
 * via ServerHandle.close(). This handler focuses on closing MCP client
 * connections.
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
    @$inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @$inject(TYPES.Logger) private logger: ILogger,
  ) {}

  /**
   * Perform graceful shutdown.
   *
   * This method closes all client connections and exits the process.
   * Note: Server handle should be closed before calling this.
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down...");

    // Close all client connections
    await this.clientPool.close();

    this.logger.info("Shutdown complete");

    process.exit(0);
  }
}
