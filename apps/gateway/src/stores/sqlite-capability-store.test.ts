import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SQLiteDatabase } from "./sqlite-database.js";
import { SQLiteCapabilityStore } from "./sqlite-capability-store.js";
import type { ILogger, ClientCapabilities } from "../types/interfaces.js";

// Mock logger factory
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
});

describe("SQLiteCapabilityStore", () => {
  let db: SQLiteDatabase;
  let store: SQLiteCapabilityStore;
  let logger: ILogger;

  beforeEach(() => {
    db = new SQLiteDatabase(":memory:");
    logger = createMockLogger();
    store = new SQLiteCapabilityStore(db, logger);
  });

  afterEach(() => {
    db.close();
  });

  describe("setCapabilities", () => {
    it("should store capabilities for a session", () => {
      const sessionId = "session-123";
      const caps: ClientCapabilities = {
        sampling: { context: {} },
      };

      store.setCapabilities(sessionId, caps);

      const result = store.getCapabilities(sessionId);
      expect(result).toEqual(caps);
    });

    it("should overwrite existing capabilities for same session", () => {
      const sessionId = "session-456";
      const oldCaps: ClientCapabilities = {
        sampling: { context: {} },
      };
      const newCaps: ClientCapabilities = {
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
      const caps: ClientCapabilities = {
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
      const caps: ClientCapabilities = {};

      store.setCapabilities(sessionId, caps);

      expect(logger.debug).toHaveBeenCalledWith(
        `Stored capabilities for session ${sessionId}: sampling=false, elicitation=false`,
      );
    });

    it("should persist capabilities to SQLite", () => {
      const sessionId = "session-persist";
      const caps: ClientCapabilities = {
        sampling: { tools: {} },
      };

      store.setCapabilities(sessionId, caps);

      // Create a new store instance with the same DB to verify persistence
      const newStore = new SQLiteCapabilityStore(db, createMockLogger());
      const result = newStore.getCapabilities(sessionId);
      expect(result).toEqual(caps);
    });
  });

  describe("getCapabilities", () => {
    it("should return capabilities for existing session", () => {
      const sessionId = "session-get";
      const caps: ClientCapabilities = {
        sampling: { tools: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.getCapabilities(sessionId)).toEqual(caps);
    });

    it("should return undefined for non-existent session", () => {
      expect(store.getCapabilities("nonexistent-session")).toBeUndefined();
    });

    it("should update last_activity timestamp on read", () => {
      const sessionId = "session-activity";
      const caps: ClientCapabilities = {};

      store.setCapabilities(sessionId, caps);

      // Wait a bit
      const beforeRead = Date.now();
      // Trigger the get
      store.getCapabilities(sessionId);

      // Check the DB directly
      const database = db.getDatabase();
      const row = database
        .prepare(`SELECT last_activity FROM sessions WHERE session_id = ?`)
        .get(sessionId) as { last_activity: number };

      expect(row.last_activity).toBeGreaterThanOrEqual(beforeRead);
    });
  });

  describe("hasCapability", () => {
    it("should return true when session has sampling capability", () => {
      const sessionId = "session-has-sampling";
      const caps: ClientCapabilities = {
        sampling: { context: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasCapability(sessionId, "sampling")).toBe(true);
    });

    it("should return true when session has elicitation capability", () => {
      const sessionId = "session-has-elicitation";
      const caps: ClientCapabilities = {
        elicitation: { form: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasCapability(sessionId, "elicitation")).toBe(true);
    });

    it("should return false when session lacks the capability", () => {
      const sessionId = "session-no-sampling";
      const caps: ClientCapabilities = {
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
      const caps: ClientCapabilities = {};

      store.setCapabilities(sessionId, caps);

      expect(store.hasCapability(sessionId, "sampling")).toBe(false);
      expect(store.hasCapability(sessionId, "elicitation")).toBe(false);
    });
  });

  describe("hasElicitationMode", () => {
    it("should return true when session has form elicitation mode", () => {
      const sessionId = "session-form";
      const caps: ClientCapabilities = {
        elicitation: { form: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasElicitationMode(sessionId, "form")).toBe(true);
    });

    it("should return true when session has url elicitation mode", () => {
      const sessionId = "session-url";
      const caps: ClientCapabilities = {
        elicitation: { url: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasElicitationMode(sessionId, "url")).toBe(true);
    });

    it("should return true when session has both elicitation modes", () => {
      const sessionId = "session-both";
      const caps: ClientCapabilities = {
        elicitation: { form: {}, url: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasElicitationMode(sessionId, "form")).toBe(true);
      expect(store.hasElicitationMode(sessionId, "url")).toBe(true);
    });

    it("should return false when session lacks the elicitation mode", () => {
      const sessionId = "session-only-form";
      const caps: ClientCapabilities = {
        elicitation: { form: {} },
      };

      store.setCapabilities(sessionId, caps);

      expect(store.hasElicitationMode(sessionId, "url")).toBe(false);
    });

    it("should return false when session has no elicitation capability", () => {
      const sessionId = "session-no-elicitation";
      const caps: ClientCapabilities = {
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
      const caps: ClientCapabilities = {
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
      const caps1: ClientCapabilities = { sampling: { context: {} } };
      const caps2: ClientCapabilities = { elicitation: { form: {} } };

      store.setCapabilities(session1, caps1);
      store.setCapabilities(session2, caps2);

      store.deleteCapabilities(session1);

      expect(store.getCapabilities(session1)).toBeUndefined();
      expect(store.getCapabilities(session2)).toEqual(caps2);
    });

    it("should also remove working directory when deleting", () => {
      const sessionId = "session-with-cwd";
      store.setCapabilities(sessionId, {});
      store.setWorkingDirectory(sessionId, "/tmp/test");

      store.deleteCapabilities(sessionId);

      expect(store.getWorkingDirectory(sessionId)).toBeUndefined();
    });
  });

  describe("setWorkingDirectory", () => {
    it("should store working directory for a session", () => {
      const sessionId = "session-cwd";
      const cwd = "/path/to/working/dir";

      store.setWorkingDirectory(sessionId, cwd);

      expect(store.getWorkingDirectory(sessionId)).toBe(cwd);
    });

    it("should overwrite existing working directory", () => {
      const sessionId = "session-cwd-update";

      store.setWorkingDirectory(sessionId, "/old/path");
      store.setWorkingDirectory(sessionId, "/new/path");

      expect(store.getWorkingDirectory(sessionId)).toBe("/new/path");
    });

    it("should log debug message", () => {
      const sessionId = "session-cwd-log";
      const cwd = "/test/path";

      store.setWorkingDirectory(sessionId, cwd);

      expect(logger.debug).toHaveBeenCalledWith(
        `Set working directory for session ${sessionId}: ${cwd}`,
      );
    });

    it("should persist working directory to SQLite", () => {
      const sessionId = "session-cwd-persist";
      const cwd = "/persisted/path";

      store.setWorkingDirectory(sessionId, cwd);

      // Create a new store instance
      const newStore = new SQLiteCapabilityStore(db, createMockLogger());
      expect(newStore.getWorkingDirectory(sessionId)).toBe(cwd);
    });
  });

  describe("getWorkingDirectory", () => {
    it("should return working directory for existing session", () => {
      const sessionId = "session-get-cwd";
      const cwd = "/some/path";

      store.setWorkingDirectory(sessionId, cwd);

      expect(store.getWorkingDirectory(sessionId)).toBe(cwd);
    });

    it("should return undefined for non-existent session", () => {
      expect(store.getWorkingDirectory("nonexistent")).toBeUndefined();
    });

    it("should return undefined when session exists but has no working directory", () => {
      const sessionId = "session-no-cwd";
      store.setCapabilities(sessionId, {});

      expect(store.getWorkingDirectory(sessionId)).toBeUndefined();
    });

    it("should update last_activity timestamp on read", () => {
      const sessionId = "session-cwd-activity";
      store.setWorkingDirectory(sessionId, "/test");

      const beforeRead = Date.now();
      store.getWorkingDirectory(sessionId);

      const database = db.getDatabase();
      const row = database
        .prepare(`SELECT last_activity FROM sessions WHERE session_id = ?`)
        .get(sessionId) as { last_activity: number };

      expect(row.last_activity).toBeGreaterThanOrEqual(beforeRead);
    });
  });

  describe("data isolation", () => {
    it("should keep capabilities and working directory separate per session", () => {
      store.setCapabilities("session-a", { sampling: { context: {} } });
      store.setCapabilities("session-b", { elicitation: { form: {} } });
      store.setWorkingDirectory("session-a", "/path/a");
      store.setWorkingDirectory("session-b", "/path/b");

      expect(store.getCapabilities("session-a")).toEqual({
        sampling: { context: {} },
      });
      expect(store.getCapabilities("session-b")).toEqual({
        elicitation: { form: {} },
      });
      expect(store.getWorkingDirectory("session-a")).toBe("/path/a");
      expect(store.getWorkingDirectory("session-b")).toBe("/path/b");
    });
  });
});
