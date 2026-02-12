import { describe, it, expect } from "vitest";
import { DEFAULT_SESSION_ID, getEffectiveSessionId } from "./session.js";

describe("session utilities", () => {
  describe("DEFAULT_SESSION_ID", () => {
    it("should be 'default'", () => {
      expect(DEFAULT_SESSION_ID).toBe("default");
    });
  });

  describe("getEffectiveSessionId", () => {
    it("should return the provided session ID when defined", () => {
      expect(getEffectiveSessionId("my-session")).toBe("my-session");
      expect(getEffectiveSessionId("abc123")).toBe("abc123");
    });

    it("should return DEFAULT_SESSION_ID when session ID is undefined", () => {
      expect(getEffectiveSessionId(undefined)).toBe(DEFAULT_SESSION_ID);
    });

    it("should return DEFAULT_SESSION_ID when session ID is empty string", () => {
      expect(getEffectiveSessionId("")).toBe(DEFAULT_SESSION_ID);
    });

    it("should preserve special characters in session IDs", () => {
      expect(getEffectiveSessionId("session-with-dashes")).toBe(
        "session-with-dashes",
      );
      expect(getEffectiveSessionId("session_with_underscores")).toBe(
        "session_with_underscores",
      );
    });
  });
});
