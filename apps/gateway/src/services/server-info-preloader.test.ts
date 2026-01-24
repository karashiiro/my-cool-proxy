import { describe, it, expect, beforeEach, vi } from "vitest";
import { ServerInfoPreloader } from "./server-info-preloader.js";
import type { ILogger, SkillMetadata } from "../types/interfaces.js";

describe("ServerInfoPreloader", () => {
  let preloader: ServerInfoPreloader;
  let mockLogger: ILogger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    preloader = new ServerInfoPreloader(mockLogger);
  });

  describe("buildSkillInstructions", () => {
    it("should return empty string for empty skills array", () => {
      const result = preloader.buildSkillInstructions([]);

      expect(result).toBe("");
    });

    it("should format single skill as XML correctly", () => {
      const skills: SkillMetadata[] = [
        {
          name: "test-skill",
          description: "A test skill for testing",
          path: "/path/to/skill",
        },
      ];

      const result = preloader.buildSkillInstructions(skills);

      expect(result).toContain("## Available Gateway Skills");
      expect(result).toContain("<available_skills>");
      expect(result).toContain("</available_skills>");
      expect(result).toContain("<skill>");
      expect(result).toContain("<name>test-skill</name>");
      expect(result).toContain(
        "<description>A test skill for testing</description>",
      );
      expect(result).toContain("</skill>");
      expect(result).toContain("load-gateway-skill");
    });

    it("should format multiple skills correctly", () => {
      const skills: SkillMetadata[] = [
        {
          name: "skill-a",
          description: "First skill",
          path: "/path/a",
        },
        {
          name: "skill-b",
          description: "Second skill",
          path: "/path/b",
        },
        {
          name: "skill-c",
          description: "Third skill",
          path: "/path/c",
        },
      ];

      const result = preloader.buildSkillInstructions(skills);

      expect(result).toContain("<name>skill-a</name>");
      expect(result).toContain("<name>skill-b</name>");
      expect(result).toContain("<name>skill-c</name>");
      expect(result).toContain("<description>First skill</description>");
      expect(result).toContain("<description>Second skill</description>");
      expect(result).toContain("<description>Third skill</description>");
    });

    it("should escape XML special characters in name", () => {
      const skills: SkillMetadata[] = [
        {
          name: "skill <with> special & chars",
          description: "Normal description",
          path: "/path",
        },
      ];

      const result = preloader.buildSkillInstructions(skills);

      expect(result).toContain(
        "<name>skill &lt;with&gt; special &amp; chars</name>",
      );
      expect(result).not.toContain("<name>skill <with>");
    });

    it("should escape XML special characters in description", () => {
      const skills: SkillMetadata[] = [
        {
          name: "test-skill",
          description: "Uses <tags> & \"quotes\" and 'apostrophes'",
          path: "/path",
        },
      ];

      const result = preloader.buildSkillInstructions(skills);

      expect(result).toContain(
        "<description>Uses &lt;tags&gt; &amp; &quot;quotes&quot; and &apos;apostrophes&apos;</description>",
      );
    });

    it("should handle empty description", () => {
      const skills: SkillMetadata[] = [
        {
          name: "no-desc-skill",
          description: "",
          path: "/path",
        },
      ];

      const result = preloader.buildSkillInstructions(skills);

      expect(result).toContain("<name>no-desc-skill</name>");
      expect(result).toContain("<description></description>");
    });

    it("should include guidance about load-gateway-skill tool", () => {
      const skills: SkillMetadata[] = [
        {
          name: "test",
          description: "test",
          path: "/path",
        },
      ];

      const result = preloader.buildSkillInstructions(skills);

      expect(result).toContain("`load-gateway-skill`");
      expect(result).toContain("full instructions");
    });
  });

  describe("buildAggregatedInstructions", () => {
    it("should return message about no servers when empty", () => {
      const result = preloader.buildAggregatedInstructions([]);

      expect(result).toContain("No upstream servers are currently configured");
    });

    it("should include server info in output", () => {
      const servers = [
        {
          name: "test-server",
          serverName: "Test Server",
          description: "A test server",
          version: "1.0.0",
        },
      ];

      const result = preloader.buildAggregatedInstructions(servers);

      expect(result).toContain("## test-server");
      expect(result).toContain("Server name: Test Server");
      expect(result).toContain("Description: A test server");
      expect(result).toContain("list-servers");
      expect(result).toContain("list-server-tools");
    });

    it("should truncate long instructions", () => {
      const longInstructions = "A".repeat(300);
      const servers = [
        {
          name: "long-server",
          instructions: longInstructions,
        },
      ];

      const result = preloader.buildAggregatedInstructions(servers);

      expect(result).toContain("Instructions:");
      expect(result).toContain("...");
      expect(result.length).toBeLessThan(
        longInstructions.length + 200, // some buffer for headers
      );
    });
  });
});
