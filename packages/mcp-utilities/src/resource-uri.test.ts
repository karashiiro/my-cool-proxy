import { describe, it, expect } from "vitest";
import {
  SKILL_URI_SCHEME,
  createSkillResourceUri,
  parseSkillResourceUri,
  isSkillResourceUri,
} from "./resource-uri.js";

describe("resource-uri utils", () => {
  // ===========================================================================
  // Skill URI Utilities
  // ===========================================================================

  describe("SKILL_URI_SCHEME", () => {
    it("should be gw-skill://", () => {
      expect(SKILL_URI_SCHEME).toBe("gw-skill://");
    });
  });

  describe("createSkillResourceUri", () => {
    it("should create a skill URI without path", () => {
      const result = createSkillResourceUri("pdf-rotation");

      expect(result).toBe("gw-skill://pdf-rotation");
    });

    it("should create a skill URI with path", () => {
      const result = createSkillResourceUri(
        "pdf-rotation",
        "scripts/rotate.py",
      );

      expect(result).toBe("gw-skill://pdf-rotation/scripts/rotate.py");
    });

    it("should handle nested paths", () => {
      const result = createSkillResourceUri(
        "my-skill",
        "references/api/endpoints.md",
      );

      expect(result).toBe("gw-skill://my-skill/references/api/endpoints.md");
    });

    it("should handle empty path as no path", () => {
      const result = createSkillResourceUri("test-skill", "");

      expect(result).toBe("gw-skill://test-skill");
    });

    it("should handle skill names with hyphens", () => {
      const result = createSkillResourceUri("my-cool-skill");

      expect(result).toBe("gw-skill://my-cool-skill");
    });

    it("should handle paths with special characters", () => {
      const result = createSkillResourceUri(
        "skill",
        "assets/file with spaces.txt",
      );

      expect(result).toBe("gw-skill://skill/assets/file with spaces.txt");
    });
  });

  describe("parseSkillResourceUri", () => {
    it("should parse a skill URI without path", () => {
      const result = parseSkillResourceUri("gw-skill://pdf-rotation");

      expect(result).toEqual({ skillName: "pdf-rotation" });
    });

    it("should parse a skill URI with path", () => {
      const result = parseSkillResourceUri(
        "gw-skill://pdf-rotation/scripts/rotate.py",
      );

      expect(result).toEqual({
        skillName: "pdf-rotation",
        path: "scripts/rotate.py",
      });
    });

    it("should parse nested paths correctly", () => {
      const result = parseSkillResourceUri(
        "gw-skill://my-skill/references/api/endpoints.md",
      );

      expect(result).toEqual({
        skillName: "my-skill",
        path: "references/api/endpoints.md",
      });
    });

    it("should return null for non-skill URIs", () => {
      expect(parseSkillResourceUri("file:///path/to/file")).toBeNull();
      expect(parseSkillResourceUri("https://example.com")).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(parseSkillResourceUri("")).toBeNull();
    });

    it("should return null for just the scheme", () => {
      expect(parseSkillResourceUri("gw-skill://")).toBeNull();
    });

    it("should return null for malformed URIs", () => {
      expect(parseSkillResourceUri("skill:")).toBeNull();
      expect(parseSkillResourceUri("skill:/")).toBeNull();
      expect(parseSkillResourceUri("skill")).toBeNull();
    });

    it("should handle trailing slash as empty path (returns just skillName)", () => {
      const result = parseSkillResourceUri("gw-skill://my-skill/");

      expect(result).toEqual({ skillName: "my-skill" });
    });

    it("should handle skill names with hyphens and underscores", () => {
      expect(parseSkillResourceUri("gw-skill://my-cool_skill")).toEqual({
        skillName: "my-cool_skill",
      });
    });
  });

  describe("isSkillResourceUri", () => {
    it("should return true for skill URIs", () => {
      expect(isSkillResourceUri("gw-skill://pdf-rotation")).toBe(true);
      expect(isSkillResourceUri("gw-skill://my-skill/scripts/run.py")).toBe(
        true,
      );
    });

    it("should return false for file URIs", () => {
      expect(isSkillResourceUri("file:///path/to/file")).toBe(false);
    });

    it("should return false for http URIs", () => {
      expect(isSkillResourceUri("https://example.com")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isSkillResourceUri("")).toBe(false);
    });

    it("should return false for partial skill scheme", () => {
      expect(isSkillResourceUri("skill:")).toBe(false);
      expect(isSkillResourceUri("skill:/")).toBe(false);
    });
  });

  describe("skill URI round-trip", () => {
    it("should round-trip: create then parse (without path)", () => {
      const skillName = "test-skill";

      const uri = createSkillResourceUri(skillName);
      const parsed = parseSkillResourceUri(uri);

      expect(parsed).toEqual({ skillName });
    });

    it("should round-trip: create then parse (with path)", () => {
      const skillName = "test-skill";
      const path = "scripts/run.py";

      const uri = createSkillResourceUri(skillName, path);
      const parsed = parseSkillResourceUri(uri);

      expect(parsed).toEqual({ skillName, path });
    });

    it("should round-trip: create then parse (with nested path)", () => {
      const skillName = "complex-skill";
      const path = "references/api/v2/endpoints.md";

      const uri = createSkillResourceUri(skillName, path);
      const parsed = parseSkillResourceUri(uri);

      expect(parsed).toEqual({ skillName, path });
    });
  });
});
