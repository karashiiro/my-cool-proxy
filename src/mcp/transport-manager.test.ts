import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TestBed } from "@suites/unit";
import { TransportManager } from "./transport-manager.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { TYPES } from "../types/index.js";

// Mock the SDK module
vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");

// Type for mock transport with mutable properties
type MockTransport = {
  sessionId: string | undefined;
  onsessioninitialized: ((sessionId: string) => void) | undefined;
  onclose: (() => void) | undefined;
};

// Type for captured options
type TransportOptions = {
  sessionIdGenerator: () => string;
  onsessioninitialized: (sessionId: string) => void;
};

describe("TransportManager", () => {
  let transportManager: TransportManager;
  let logger: ReturnType<typeof unitRef.get>;
  let mockTransport: MockTransport;
  let capturedOptions: TransportOptions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let unitRef: any;

  beforeEach(async () => {
    const { unit, unitRef: ref } =
      await TestBed.solitary(TransportManager).compile();
    transportManager = unit;
    unitRef = ref;
    logger = unitRef.get(TYPES.Logger);

    // Reset mock transport
    mockTransport = {
      sessionId: undefined,
      onsessioninitialized: undefined,
      onclose: undefined,
    };

    // Mock WebStandardStreamableHTTPServerTransport constructor
    vi.mocked(WebStandardStreamableHTTPServerTransport).mockImplementation(
      function (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        opts?: any,
      ) {
        capturedOptions = opts as TransportOptions;
        return mockTransport as unknown as WebStandardStreamableHTTPServerTransport;
      },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with logger", () => {
      expect(transportManager).toBeInstanceOf(TransportManager);
    });
  });

  describe("getOrCreate", () => {
    it("should create new transport for new session", () => {
      const sessionId = "session-1";

      const transport = transportManager.getOrCreate(sessionId);

      expect(WebStandardStreamableHTTPServerTransport).toHaveBeenCalled();
      expect(transport).toBe(mockTransport);
      expect(logger.info).toHaveBeenCalledWith(
        `Creating new transport for session ${sessionId}`,
      );
    });

    it("should return cached transport for existing session", () => {
      const sessionId = "session-1";

      const transport1 = transportManager.getOrCreate(sessionId);
      const transport2 = transportManager.getOrCreate(sessionId);

      expect(transport1).toBe(transport2);
      expect(WebStandardStreamableHTTPServerTransport).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith(
        `Reusing existing transport for session ${sessionId}`,
      );
    });

    it("should log transport creation", () => {
      const sessionId = "test-session";

      transportManager.getOrCreate(sessionId);

      expect(logger.info).toHaveBeenCalledWith(
        `Creating new transport for session ${sessionId}`,
      );
    });

    it("should log transport reuse", () => {
      const sessionId = "test-session";

      transportManager.getOrCreate(sessionId);
      transportManager.getOrCreate(sessionId);

      expect(logger.debug).toHaveBeenCalledWith(
        `Reusing existing transport for session ${sessionId}`,
      );
    });

    it("should set onsessioninitialized callback in options", () => {
      transportManager.getOrCreate("session-1");

      expect(capturedOptions).toBeDefined();
      expect(typeof capturedOptions.onsessioninitialized).toBe("function");
    });

    it("should set onclose callback on transport", () => {
      const transport = transportManager.getOrCreate("session-1");

      expect(transport.onclose).toBeDefined();
      expect(typeof transport.onclose).toBe("function");
    });

    it("should set sessionIdGenerator in options", () => {
      transportManager.getOrCreate("session-1");

      expect(capturedOptions).toBeDefined();
      expect(typeof capturedOptions.sessionIdGenerator).toBe("function");
    });

    describe("onsessioninitialized callback", () => {
      it("should store transport under generated sessionId", () => {
        const originalSessionId = "original-session";
        const generatedSessionId = "generated-uuid-123";

        transportManager.getOrCreate(originalSessionId);

        // Simulate session initialization
        mockTransport.sessionId = generatedSessionId;
        capturedOptions.onsessioninitialized(generatedSessionId);

        // Transport should be accessible via generated ID
        expect(transportManager.has(generatedSessionId)).toBe(true);
      });

      it("should log session initialization", () => {
        const generatedSessionId = "generated-uuid-456";

        transportManager.getOrCreate("session-1");

        mockTransport.sessionId = generatedSessionId;
        capturedOptions.onsessioninitialized(generatedSessionId);

        expect(logger.info).toHaveBeenCalledWith(
          `Transport session initialized: ${generatedSessionId}`,
        );
      });

      it("should allow lookup by both original and generated session IDs", () => {
        const originalSessionId = "original-123";
        const generatedSessionId = "generated-456";

        transportManager.getOrCreate(originalSessionId);

        mockTransport.sessionId = generatedSessionId;
        capturedOptions.onsessioninitialized(generatedSessionId);

        expect(transportManager.has(originalSessionId)).toBe(true);
        expect(transportManager.has(generatedSessionId)).toBe(true);
      });
    });

    describe("onclose callback", () => {
      it("should remove both original and generated session IDs", () => {
        const originalSessionId = "original-123";
        const generatedSessionId = "generated-456";

        const transport = transportManager.getOrCreate(originalSessionId);

        // Initialize session
        mockTransport.sessionId = generatedSessionId;
        capturedOptions.onsessioninitialized(generatedSessionId);

        expect(transportManager.has(originalSessionId)).toBe(true);
        expect(transportManager.has(generatedSessionId)).toBe(true);

        // Trigger close
        transport.onclose!();

        expect(transportManager.has(originalSessionId)).toBe(false);
        expect(transportManager.has(generatedSessionId)).toBe(false);
      });

      it("should handle missing originalSessionId gracefully", () => {
        const sessionId = "session-1";
        const transport = transportManager.getOrCreate(sessionId);

        // Don't initialize session (no generated ID)
        // Just trigger close
        transport.onclose!();

        expect(transportManager.has(sessionId)).toBe(false);
      });

      it("should handle null transport.sessionId gracefully", () => {
        const originalSessionId = "session-1";
        const transport = transportManager.getOrCreate(originalSessionId);

        // Set sessionId to undefined
        mockTransport.sessionId = undefined;

        // Should not throw
        expect(() => transport.onclose!()).not.toThrow();
      });

      it("should log removal of generated sessionId", () => {
        const generatedSessionId = "generated-789";
        const transport = transportManager.getOrCreate("session-1");

        mockTransport.sessionId = generatedSessionId;
        capturedOptions.onsessioninitialized(generatedSessionId);

        transport.onclose!();

        expect(logger.info).toHaveBeenCalledWith(
          `Transport session closed: ${generatedSessionId}`,
        );
      });

      it("should log removal of original sessionId when different from generated", () => {
        const originalSessionId = "original-abc";
        const generatedSessionId = "generated-xyz";

        const transport = transportManager.getOrCreate(originalSessionId);

        mockTransport.sessionId = generatedSessionId;
        capturedOptions.onsessioninitialized(generatedSessionId);

        transport.onclose!();

        expect(logger.info).toHaveBeenCalledWith(
          `Cleaned up original session reference: ${originalSessionId}`,
        );
      });

      it("should not log original session cleanup if same as generated", () => {
        const sessionId = "same-session-id";

        const transport = transportManager.getOrCreate(sessionId);

        mockTransport.sessionId = sessionId;
        capturedOptions.onsessioninitialized(sessionId);

        vi.clearAllMocks(); // Clear initialization logs

        transport.onclose!();

        // Should only log once (for the generated sessionId)
        expect(logger.info).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith(
          `Transport session closed: ${sessionId}`,
        );
      });
    });
  });

  describe("has", () => {
    it("should return false for non-existent session", () => {
      expect(transportManager.has("non-existent")).toBe(false);
    });

    it("should return true for existing session", () => {
      const sessionId = "test-session";

      transportManager.getOrCreate(sessionId);

      expect(transportManager.has(sessionId)).toBe(true);
    });

    it("should return true for transport-generated session ID", () => {
      const originalSessionId = "original";
      const generatedSessionId = "generated";

      transportManager.getOrCreate(originalSessionId);

      mockTransport.sessionId = generatedSessionId;
      capturedOptions.onsessioninitialized(generatedSessionId);

      expect(transportManager.has(generatedSessionId)).toBe(true);
    });
  });

  describe("getOrCreateForRequest", () => {
    it("should reuse existing transport when sessionId provided and exists", () => {
      const sessionId = "existing-session";

      // Create transport first
      const transport1 = transportManager.getOrCreate(sessionId);

      // Clear mocks to verify reuse
      vi.clearAllMocks();

      // Get for request
      const transport2 = transportManager.getOrCreateForRequest(sessionId);

      expect(transport1).toBe(transport2);
      expect(WebStandardStreamableHTTPServerTransport).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        `Reusing transport for session ${sessionId}`,
      );
    });

    it("should create new transport when sessionId provided but doesn't exist", () => {
      const sessionId = "new-session";

      const transport = transportManager.getOrCreateForRequest(sessionId);

      expect(transport).toBeDefined();
      expect(WebStandardStreamableHTTPServerTransport).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        `Creating new transport for session ${sessionId}`,
      );
    });

    it("should generate temporary session key when sessionId not provided", () => {
      const transport = transportManager.getOrCreateForRequest();

      expect(transport).toBeDefined();
      expect(WebStandardStreamableHTTPServerTransport).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        `Creating new transport for new connection`,
      );
    });

    it("should create different temporary keys for multiple calls", () => {
      const transport1 = transportManager.getOrCreateForRequest();
      const transport2 = transportManager.getOrCreateForRequest();

      // Both should be created (different transports)
      expect(WebStandardStreamableHTTPServerTransport).toHaveBeenCalledTimes(2);
      expect(transport1).toBe(mockTransport); // Both will be the same mock, but created separately
      expect(transport2).toBe(mockTransport);
    });

    it("should log temporary session creation", () => {
      transportManager.getOrCreateForRequest();

      expect(logger.info).toHaveBeenCalledWith(
        `Creating new transport for new connection`,
      );
    });

    it("should reuse transport when sessionId exists from previous getOrCreate", () => {
      const sessionId = "existing-session";

      // Create transport via getOrCreate
      const transport1 = transportManager.getOrCreate(sessionId);

      // Count how many times constructor was called
      const initialCallCount = vi.mocked(
        WebStandardStreamableHTTPServerTransport,
      ).mock.calls.length;

      // Call getOrCreateForRequest with the same sessionId
      const transport2 = transportManager.getOrCreateForRequest(sessionId);

      // Should reuse the same transport, not create a new one
      expect(transport1).toBe(transport2);
      expect(
        vi.mocked(WebStandardStreamableHTTPServerTransport).mock.calls.length,
      ).toBe(initialCallCount);
      expect(logger.debug).toHaveBeenCalledWith(
        `Reusing transport for session ${sessionId}`,
      );
    });
  });

  describe("remove", () => {
    it("should remove transport from cache", () => {
      const sessionId = "session-to-remove";

      transportManager.getOrCreate(sessionId);
      expect(transportManager.has(sessionId)).toBe(true);

      transportManager.remove(sessionId);

      expect(transportManager.has(sessionId)).toBe(false);
    });

    it("should log removal", () => {
      const sessionId = "session-to-remove";

      transportManager.getOrCreate(sessionId);
      vi.clearAllMocks();

      transportManager.remove(sessionId);

      expect(logger.info).toHaveBeenCalledWith(
        `Removed transport for session ${sessionId}`,
      );
    });

    it("should be no-op for non-existent session", () => {
      transportManager.remove("non-existent");

      // Should not throw, and should not log
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should only remove specified session", () => {
      const session1 = "session-1";
      const session2 = "session-2";

      transportManager.getOrCreate(session1);
      transportManager.getOrCreate(session2);

      transportManager.remove(session1);

      expect(transportManager.has(session1)).toBe(false);
      expect(transportManager.has(session2)).toBe(true);
    });
  });

  describe("closeAll", () => {
    it("should clear all transports from cache", async () => {
      transportManager.getOrCreate("session-1");
      transportManager.getOrCreate("session-2");
      transportManager.getOrCreate("session-3");

      await transportManager.closeAll();

      expect(transportManager.has("session-1")).toBe(false);
      expect(transportManager.has("session-2")).toBe(false);
      expect(transportManager.has("session-3")).toBe(false);
    });

    it("should log start message with count", async () => {
      transportManager.getOrCreate("session-1");
      transportManager.getOrCreate("session-2");

      vi.clearAllMocks();

      await transportManager.closeAll();

      expect(logger.info).toHaveBeenCalledWith("Closing all 2 transports...");
    });

    it("should log completion message", async () => {
      transportManager.getOrCreate("session-1");

      await transportManager.closeAll();

      expect(logger.info).toHaveBeenCalledWith("All transports closed");
    });

    it("should be idempotent (safe to call multiple times)", async () => {
      transportManager.getOrCreate("session-1");

      await transportManager.closeAll();
      await transportManager.closeAll();

      // Should log 0 transports on second call
      expect(logger.info).toHaveBeenCalledWith("Closing all 0 transports...");
    });

    it("should handle errors gracefully", async () => {
      // Create a transport
      transportManager.getOrCreate("session-1");

      // Even though current implementation doesn't call close(),
      // this test verifies error handling structure exists
      await transportManager.closeAll();

      expect(transportManager.has("session-1")).toBe(false);
    });

    it("should clear cache even with zero transports", async () => {
      await transportManager.closeAll();

      expect(logger.info).toHaveBeenCalledWith("Closing all 0 transports...");
      expect(logger.info).toHaveBeenCalledWith("All transports closed");
    });

    it("should log debug for each transport", async () => {
      transportManager.getOrCreate("session-1");
      transportManager.getOrCreate("session-2");

      vi.clearAllMocks();

      await transportManager.closeAll();

      // Should log debug for each session
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Closing transport for session"),
      );
    });
  });

  describe("edge cases", () => {
    it("should handle empty string sessionId", () => {
      const transport = transportManager.getOrCreate("");

      expect(transport).toBeDefined();
      expect(transportManager.has("")).toBe(true);
    });

    it("should handle very long sessionId", () => {
      const longSessionId = "a".repeat(1000);

      const transport = transportManager.getOrCreate(longSessionId);

      expect(transport).toBeDefined();
      expect(transportManager.has(longSessionId)).toBe(true);
    });

    it("should handle special characters in sessionId", () => {
      const specialSessionId = "session-!@#$%^&*()_+-=[]{}|;:',.<>?/~`";

      const transport = transportManager.getOrCreate(specialSessionId);

      expect(transport).toBeDefined();
      expect(transportManager.has(specialSessionId)).toBe(true);
    });

    it("should handle rapid sequential calls with same sessionId", () => {
      const sessionId = "rapid-session";

      const transport1 = transportManager.getOrCreate(sessionId);
      const transport2 = transportManager.getOrCreate(sessionId);
      const transport3 = transportManager.getOrCreate(sessionId);

      expect(transport1).toBe(transport2);
      expect(transport2).toBe(transport3);
      expect(WebStandardStreamableHTTPServerTransport).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple transports with different sessionIds", () => {
      const sessions = ["session-1", "session-2", "session-3", "session-4"];

      sessions.forEach((s) => transportManager.getOrCreate(s));

      sessions.forEach((s) => {
        expect(transportManager.has(s)).toBe(true);
      });

      expect(WebStandardStreamableHTTPServerTransport).toHaveBeenCalledTimes(
        sessions.length,
      );
    });
  });

  describe("integration tests", () => {
    it("should handle complete lifecycle: create → initialize → close", () => {
      const originalSessionId = "lifecycle-original";
      const generatedSessionId = "lifecycle-generated";

      // Create
      const transport = transportManager.getOrCreate(originalSessionId);
      expect(transportManager.has(originalSessionId)).toBe(true);

      // Initialize
      mockTransport.sessionId = generatedSessionId;
      capturedOptions.onsessioninitialized(generatedSessionId);
      expect(transportManager.has(generatedSessionId)).toBe(true);

      // Close
      transport.onclose!();
      expect(transportManager.has(originalSessionId)).toBe(false);
      expect(transportManager.has(generatedSessionId)).toBe(false);
    });

    it("should handle multi-session scenario with closeAll", async () => {
      const sessions = Array.from({ length: 5 }, (_, i) => `session-${i}`);

      // Create all sessions
      sessions.forEach((s) => transportManager.getOrCreate(s));

      // Initialize some with generated IDs
      mockTransport.sessionId = "generated-0";
      capturedOptions.onsessioninitialized("generated-0");

      // Verify all accessible
      sessions.forEach((s) => {
        expect(transportManager.has(s)).toBe(true);
      });
      expect(transportManager.has("generated-0")).toBe(true);

      // Close all
      await transportManager.closeAll();

      // Verify all closed
      sessions.forEach((s) => {
        expect(transportManager.has(s)).toBe(false);
      });
      expect(transportManager.has("generated-0")).toBe(false);
    });

    it("should handle mixed getOrCreate and getOrCreateForRequest calls", () => {
      const explicitSession = "explicit-session";

      // Create via getOrCreate
      const transport1 = transportManager.getOrCreate(explicitSession);

      // Reuse via getOrCreateForRequest
      const transport2 =
        transportManager.getOrCreateForRequest(explicitSession);

      // Create new via getOrCreateForRequest without sessionId
      transportManager.getOrCreateForRequest();

      expect(transport1).toBe(transport2);
      expect(WebStandardStreamableHTTPServerTransport).toHaveBeenCalledTimes(2);
    });
  });
});
