import { describe, it, expect } from "vitest";
import { DEFAULT_SESSION_ID, normalizeSessionId } from "./session.js";

describe("DEFAULT_SESSION_ID", () => {
  it('equals "default"', () => {
    expect(DEFAULT_SESSION_ID).toBe("default");
  });
});

describe("normalizeSessionId", () => {
  it("returns the provided session ID when defined", () => {
    expect(normalizeSessionId("my-session")).toBe("my-session");
  });

  it("returns default when undefined", () => {
    expect(normalizeSessionId(undefined)).toBe("default");
  });

  it("returns default for empty string", () => {
    expect(normalizeSessionId("")).toBe("default");
  });
});
