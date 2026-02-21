import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ShutdownHandler } from "./shutdown-handler.js";
import type { ILogger, IMCPClientManager } from "../types/interfaces.js";

// Mock logger factory
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
});

// Mock client manager factory
const createMockClientManager = (): IMCPClientManager => ({
  addHttpClient: vi.fn(),
  addStdioClient: vi.fn(),
  getClient: vi.fn(),
  getClientsBySession: vi.fn(),
  getFailedServers: vi.fn(),
  closeSession: vi.fn(),
  getActiveSessions: vi.fn().mockReturnValue([]),
  setResourceListChangedHandler: vi.fn(),
  setPromptListChangedHandler: vi.fn(),
  setToolListChangedHandler: vi.fn(),
  setLoggingMessageHandler: vi.fn(),
  close: vi.fn(),
});

describe("ShutdownHandler", () => {
  let shutdownHandler: ShutdownHandler;
  let logger: ILogger;
  let clientPool: IMCPClientManager;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = createMockLogger();
    clientPool = createMockClientManager();
    shutdownHandler = new ShutdownHandler(clientPool, logger);

    // Mock process.exit to prevent actual exit
    mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  describe("shutdown", () => {
    it("should log 'Shutting down...' message", async () => {
      vi.mocked(clientPool.close).mockResolvedValue(undefined);

      await shutdownHandler.shutdown();

      expect(logger.info).toHaveBeenCalledWith("Shutting down...");
    });

    it("should call clientPool.close()", async () => {
      vi.mocked(clientPool.close).mockResolvedValue(undefined);

      await shutdownHandler.shutdown();

      expect(clientPool.close).toHaveBeenCalledTimes(1);
    });

    it("should log 'Shutdown complete' message after closing clients", async () => {
      vi.mocked(clientPool.close).mockResolvedValue(undefined);

      await shutdownHandler.shutdown();

      // Verify order: "Shutting down..." should be first, then "Shutdown complete"
      const infoCalls = vi.mocked(logger.info).mock.calls;
      expect(infoCalls[0]?.[0]).toBe("Shutting down...");
      expect(infoCalls[1]?.[0]).toBe("Shutdown complete");
    });

    it("should call process.exit(0)", async () => {
      vi.mocked(clientPool.close).mockResolvedValue(undefined);

      await shutdownHandler.shutdown();

      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should execute operations in correct order", async () => {
      const executionOrder: string[] = [];

      vi.mocked(logger.info).mockImplementation((...args: unknown[]) => {
        // Handle both overloads: info(msg) and info(obj, msg)
        const msg = typeof args[0] === "string" ? args[0] : args[1];
        executionOrder.push(`log: ${msg}`);
      });

      vi.mocked(clientPool.close).mockImplementation(async () => {
        executionOrder.push("clientPool.close");
      });

      mockExit.mockImplementation((() => {
        executionOrder.push("process.exit");
      }) as () => never);

      await shutdownHandler.shutdown();

      expect(executionOrder).toEqual([
        "log: Shutting down...",
        "clientPool.close",
        "log: Shutdown complete",
        "process.exit",
      ]);
    });

    it("should propagate errors from clientPool.close()", async () => {
      const closeError = new Error("Failed to close clients");
      vi.mocked(clientPool.close).mockRejectedValue(closeError);

      await expect(shutdownHandler.shutdown()).rejects.toThrow(
        "Failed to close clients",
      );

      // Should log "Shutting down..." but not "Shutdown complete"
      expect(logger.info).toHaveBeenCalledWith("Shutting down...");
      expect(logger.info).not.toHaveBeenCalledWith("Shutdown complete");

      // Should not call process.exit on error
      expect(mockExit).not.toHaveBeenCalled();
    });
  });
});
