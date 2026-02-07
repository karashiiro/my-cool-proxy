import { describe, it, expect, beforeEach, vi } from "vitest";
import { CapabilityStore } from "./capability-store.js";
import type { ILogger, DownstreamCapabilities } from "../types/interfaces.js";

// Mock logger factory
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

describe("CapabilityStore", () => {
  let store: CapabilityStore;
  let logger: ILogger;

  beforeEach(() => {
    logger = createMockLogger();
    store = new CapabilityStore(logger);
  });

  describe("setCapabilities", () => {
    it("should store capabilities for a session", () => {
      const sessionId = "session-123";
      const caps: DownstreamCapabilities = {
        sampling: { context: {} },
      };

      store.setCapabilities(sessionId, caps);

      const result = store.getCapabilities(sessionId);
      expect(result).toEqual(caps);
    });

    it("should overwrite existing capabilities for same session", () => {
      const sessionId = "session-456";
      const oldCaps: DownstreamCapabilities = {
        sampling: { context: {} },
      };
      const newCaps: DownstreamCapabilities = {
        elicitation: { form: {} },
      };

      store.setCapabilities(sessionId, oldCaps);
      store.setCapabilities(sessionId, newCaps);

      const result = store.getCapabilities(sessionId);
      expect(result).toEqual(newCaps);
      expect(result?.sampling).toBeUndefined();
    });

    it("should log debug message with capability status", () => {
      const sessionId = "session-log";
      const caps: DownstreamCapabilities = {
        sampling: { context: {} },
        elicitation: { form: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(logger.debug).toHaveBeenCalledWith(
        `Stored capabilities for session ${sessionId}: sampling=true, elicitation=true`,
      );
    });

    it("should log false for missing capabilities", () => {
      const sessionId = "session-empty";
      const caps: DownstreamCapabilities = {};

      store.setCapabilities(sessionId, caps);

      expect(logger.debug).toHaveBeenCalledWith(
        `Stored capabilities for session ${sessionId}: sampling=false, elicitation=false`,
      );
    });
  });

  describe("getCapabilities", () => {
    it("should return capabilities for existing session", () => {
      const sessionId = "session-get";
      const caps: DownstreamCapabilities = {
        sampling: { tools: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.getCapabilities(sessionId)).toEqual(caps);
    });

    it("should return undefined for non-existent session", () => {
      expect(store.getCapabilities("nonexistent-session")).toBeUndefined();
    });
  });

  describe("hasCapability", () => {
    it("should return true when session has sampling capability", () => {
      const sessionId = "session-has-sampling";
      const caps: DownstreamCapabilities = {
        sampling: { context: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasCapability(sessionId, "sampling")).toBe(true);
    });

    it("should return true when session has elicitation capability", () => {
      const sessionId = "session-has-elicitation";
      const caps: DownstreamCapabilities = {
        elicitation: { form: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasCapability(sessionId, "elicitation")).toBe(true);
    });

    it("should return false when session lacks the capability", () => {
      const sessionId = "session-no-sampling";
      const caps: DownstreamCapabilities = {
        elicitation: { form: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasCapability(sessionId, "sampling")).toBe(false);
    });

    it("should return false for non-existent session", () => {
      expect(store.hasCapability("ghost-session", "sampling")).toBe(false);
      expect(store.hasCapability("ghost-session", "elicitation")).toBe(false);
    });

    it("should return false when capabilities object is empty", () => {
      const sessionId = "session-empty-caps";
      const caps: DownstreamCapabilities = {};

      store.setCapabilities(sessionId, caps);

      expect(store.hasCapability(sessionId, "sampling")).toBe(false);
      expect(store.hasCapability(sessionId, "elicitation")).toBe(false);
    });
  });

  describe("hasElicitationMode", () => {
    it("should return true when session has form elicitation mode", () => {
      const sessionId = "session-form";
      const caps: DownstreamCapabilities = {
        elicitation: { form: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasElicitationMode(sessionId, "form")).toBe(true);
    });

    it("should return true when session has url elicitation mode", () => {
      const sessionId = "session-url";
      const caps: DownstreamCapabilities = {
        elicitation: { url: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasElicitationMode(sessionId, "url")).toBe(true);
    });

    it("should return true when session has both elicitation modes", () => {
      const sessionId = "session-both";
      const caps: DownstreamCapabilities = {
        elicitation: { form: {}, url: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasElicitationMode(sessionId, "form")).toBe(true);
      expect(store.hasElicitationMode(sessionId, "url")).toBe(true);
    });

    it("should return false when session lacks the elicitation mode", () => {
      const sessionId = "session-only-form";
      const caps: DownstreamCapabilities = {
        elicitation: { form: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasElicitationMode(sessionId, "url")).toBe(false);
    });

    it("should return false when session has no elicitation capability", () => {
      const sessionId = "session-no-elicitation";
      const caps: DownstreamCapabilities = {
        sampling: { context: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasElicitationMode(sessionId, "form")).toBe(false);
      expect(store.hasElicitationMode(sessionId, "url")).toBe(false);
    });

    it("should return false for non-existent session", () => {
      expect(store.hasElicitationMode("phantom-session", "form")).toBe(false);
      expect(store.hasElicitationMode("phantom-session", "url")).toBe(false);
    });
  });

  describe("deleteCapabilities", () => {
    it("should remove capabilities for a session", () => {
      const sessionId = "session-to-delete";
      const caps: DownstreamCapabilities = {
        sampling: { context: {} },
      };

      store.setCapabilities(sessionId, caps);
      expect(store.getCapabilities(sessionId)).toBeDefined();

      store.deleteCapabilities(sessionId);

      expect(store.getCapabilities(sessionId)).toBeUndefined();
    });

    it("should log debug message when deleting", () => {
      const sessionId = "session-delete-log";

      store.deleteCapabilities(sessionId);

      expect(logger.debug).toHaveBeenCalledWith(
        `Removed capabilities for session ${sessionId}`,
      );
    });

    it("should handle deleting non-existent session gracefully", () => {
      // Should not throw
      expect(() => store.deleteCapabilities("never-existed")).not.toThrow();

      expect(logger.debug).toHaveBeenCalledWith(
        "Removed capabilities for session never-existed",
      );
    });

    it("should not affect other sessions when deleting", () => {
      const session1 = "session-1";
      const session2 = "session-2";
      const caps1: DownstreamCapabilities = { sampling: { context: {} } };
      const caps2: DownstreamCapabilities = { elicitation: { form: {} } };

      store.setCapabilities(session1, caps1);
      store.setCapabilities(session2, caps2);

      store.deleteCapabilities(session1);

      expect(store.getCapabilities(session1)).toBeUndefined();
      expect(store.getCapabilities(session2)).toEqual(caps2);
    });
  });
});
