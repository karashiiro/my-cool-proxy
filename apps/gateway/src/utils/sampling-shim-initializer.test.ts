import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";

import type { ILogger, ISamplingShim } from "../types/interfaces.js";
import { initializeSamplingShim } from "./sampling-shim-initializer.js";

describe("initializeSamplingShim", () => {
  let mockLogger: ILogger;
  let mockShim: ISamplingShim;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    mockShim = {
      initialize: vi.fn().mockResolvedValue(undefined),
      handleSamplingRequest: vi.fn(),
      close: vi.fn(),
      closeAll: vi.fn(),
    };
  });

  describe("when shim is undefined", () => {
    it("should return original capabilities without activeShim", async () => {
      const capabilities: ClientCapabilities = {
        sampling: { tools: {} },
      };

      const result = await initializeSamplingShim(
        "session-1",
        capabilities,
        undefined, // no shim configured
        mockLogger,
      );

      expect(result.activeShim).toBeUndefined();
      expect(result.upstreamCapabilities).toBe(capabilities); // same reference
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe("when client has full sampling+tools capability", () => {
    it("should return original capabilities without activeShim", async () => {
      const capabilities: ClientCapabilities = {
        sampling: { tools: {} },
      };

      const result = await initializeSamplingShim(
        "session-2",
        capabilities,
        mockShim,
        mockLogger,
      );

      expect(result.activeShim).toBeUndefined();
      expect(result.upstreamCapabilities).toBe(capabilities);
      expect(mockShim.initialize).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe("when client lacks sampling entirely", () => {
    it("should initialize shim and augment capabilities", async () => {
      const capabilities: ClientCapabilities = {
        // no sampling field
      };

      const result = await initializeSamplingShim(
        "session-3",
        capabilities,
        mockShim,
        mockLogger,
      );

      expect(result.activeShim).toBe(mockShim);
      expect(result.upstreamCapabilities).toEqual({
        sampling: { tools: {} },
      });
      expect(mockShim.initialize).toHaveBeenCalledWith("session-3");
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Session session-3: Client lacks sampling support, initializing ACP shim",
      );
    });
  });

  describe("when client has sampling but no tools support", () => {
    it("should initialize shim and augment capabilities", async () => {
      const capabilities: ClientCapabilities = {
        sampling: {}, // sampling exists but no tools field
      };

      const result = await initializeSamplingShim(
        "session-4",
        capabilities,
        mockShim,
        mockLogger,
      );

      expect(result.activeShim).toBe(mockShim);
      expect(result.upstreamCapabilities).toEqual({
        sampling: { tools: {} },
      });
      expect(mockShim.initialize).toHaveBeenCalledWith("session-4");
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Session session-4: Client has sampling but lacks tools support, initializing ACP shim",
      );
    });
  });

  describe("when client has partial sampling with other fields", () => {
    it("should preserve existing sampling fields when augmenting", async () => {
      const capabilities: ClientCapabilities = {
        sampling: {
          // no tools field, but has other fields that should be preserved
        },
        elicitation: {}, // other capabilities should also be preserved
      };

      const result = await initializeSamplingShim(
        "session-5",
        capabilities,
        mockShim,
        mockLogger,
      );

      expect(result.activeShim).toBe(mockShim);
      expect(result.upstreamCapabilities).toEqual({
        sampling: { tools: {} },
        elicitation: {},
      });
    });
  });

  describe("when shim initialization fails", () => {
    it("should return original capabilities and log error", async () => {
      const initError = new Error("Connection refused");
      mockShim.initialize = vi.fn().mockRejectedValue(initError);

      const capabilities: ClientCapabilities = {
        // no sampling
      };

      const result = await initializeSamplingShim(
        "session-6",
        capabilities,
        mockShim,
        mockLogger,
      );

      expect(result.activeShim).toBeUndefined();
      expect(result.upstreamCapabilities).toBe(capabilities);
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to initialize sampling shim, continuing without sampling support",
        initError,
      );
    });

    it("should handle non-Error thrown values", async () => {
      mockShim.initialize = vi.fn().mockRejectedValue("string error");

      const capabilities: ClientCapabilities = {};

      const result = await initializeSamplingShim(
        "session-7",
        capabilities,
        mockShim,
        mockLogger,
      );

      expect(result.activeShim).toBeUndefined();
      expect(result.upstreamCapabilities).toBe(capabilities);
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to initialize sampling shim, continuing without sampling support",
        expect.any(Error),
      );
    });
  });
});
