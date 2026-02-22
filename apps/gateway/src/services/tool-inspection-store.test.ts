import { describe, it, expect, beforeEach } from "vitest";
import { ToolInspectionStore } from "./tool-inspection-store.js";

describe("ToolInspectionStore", () => {
  let store: ToolInspectionStore;

  beforeEach(() => {
    store = new ToolInspectionStore();
  });

  describe("markInspected and isInspected", () => {
    it("should return false for uninspected tools", () => {
      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        false,
      );
    });

    it("should return true after marking a tool as inspected", () => {
      store.markInspected("session1", "github", "search_issues");
      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        true,
      );
    });

    it("should track multiple tools per session", () => {
      store.markInspected("session1", "github", "search_issues");
      store.markInspected("session1", "github", "create_pr");
      store.markInspected("session1", "slack", "send_message");

      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        true,
      );
      expect(store.isInspected("session1", "github", "create_pr")).toBe(true);
      expect(store.isInspected("session1", "slack", "send_message")).toBe(true);
      expect(store.isInspected("session1", "slack", "list_channels")).toBe(
        false,
      );
    });

    it("should isolate sessions from each other", () => {
      store.markInspected("session1", "github", "search_issues");

      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        true,
      );
      expect(store.isInspected("session2", "github", "search_issues")).toBe(
        false,
      );
    });

    it("should handle marking the same tool twice without error", () => {
      store.markInspected("session1", "github", "search_issues");
      store.markInspected("session1", "github", "search_issues");

      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        true,
      );
    });
  });

  describe("deleteSession", () => {
    it("should clear all inspections for a session", () => {
      store.markInspected("session1", "github", "search_issues");
      store.markInspected("session1", "slack", "send_message");

      store.deleteSession("session1");

      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        false,
      );
      expect(store.isInspected("session1", "slack", "send_message")).toBe(
        false,
      );
    });

    it("should not affect other sessions", () => {
      store.markInspected("session1", "github", "search_issues");
      store.markInspected("session2", "github", "search_issues");

      store.deleteSession("session1");

      expect(store.isInspected("session1", "github", "search_issues")).toBe(
        false,
      );
      expect(store.isInspected("session2", "github", "search_issues")).toBe(
        true,
      );
    });

    it("should handle deleting a non-existent session without error", () => {
      expect(() => store.deleteSession("nonexistent")).not.toThrow();
    });
  });
});
