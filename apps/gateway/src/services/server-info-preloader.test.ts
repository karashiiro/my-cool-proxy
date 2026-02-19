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
      fatal: vi.fn(),
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

      expect(result).toContain("# Available Gateway Skills");
      expect(result).toContain("<available_skills>");
      expect(result).toContain("</available_skills>");
      expect(result).toContain("<skill>");
      expect(result).toContain("<name>test-skill</name>");
      expect(result).toContain(
        "<description>A test skill for testing</description>",
      );
      expect(result).toContain("</skill>");
      expect(result).toContain("gw-skill://");
      expect(result).toContain("_gateway.read_resource");
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

    it("should include guidance about loading skills via Lua builtins", () => {
      const skills: SkillMetadata[] = [
        {
          name: "test",
          description: "test",
          path: "/path",
        },
      ];

      const result = preloader.buildSkillInstructions(skills);

      expect(result).toContain("`gw-skill://{skill-name}`");
      expect(result).toContain("skill instructions");
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
        longInstructions.length + 300, // some buffer for headers
      );
    });

    it("should include tool names in output", () => {
      const servers = [
        {
          name: "test-server",
          serverName: "Test Server",
          description: "A test server",
          toolNames: ["tool_a", "tool_b", "tool_c"],
        },
      ];

      const result = preloader.buildAggregatedInstructions(servers);

      expect(result).toContain("## test-server");
      expect(result).toContain("Tools: tool_a, tool_b, tool_c");
    });

    it("should truncate tool list when exceeding limit", () => {
      // Create array of 50 tools (limit is 40)
      const toolNames = Array.from({ length: 50 }, (_, i) => `tool_${i + 1}`);
      const servers = [
        {
          name: "many-tools-server",
          toolNames,
        },
      ];

      const result = preloader.buildAggregatedInstructions(servers);

      expect(result).toContain("Tools:");
      expect(result).toContain("(and 10 more)");
      // Should contain first 40 tools
      expect(result).toContain("tool_1");
      expect(result).toContain("tool_40");
      // Should NOT contain tool_41 through tool_50 as individual items
      expect(result).not.toContain("tool_41,");
      expect(result).not.toContain(", tool_50");
    });

    it("should omit tools line when server has no tools", () => {
      const servers = [
        {
          name: "no-tools-server",
          serverName: "No Tools Server",
          toolNames: [],
        },
      ];

      const result = preloader.buildAggregatedInstructions(servers);

      expect(result).toContain("## no-tools-server");
      expect(result).not.toContain("Tools:");
    });

    it("should include resource names in output", () => {
      const servers = [
        {
          name: "resource-server",
          resourceNames: ["file:///readme", "config://app", "db://users"],
        },
      ];

      const result = preloader.buildAggregatedInstructions(servers);

      expect(result).toContain(
        "Resources: file:///readme, config://app, db://users",
      );
    });

    it("should truncate resource list when exceeding limit", () => {
      const resourceNames = Array.from(
        { length: 15 },
        (_, i) => `res://item_${i + 1}`,
      );
      const servers = [{ name: "many-resources-server", resourceNames }];

      const result = preloader.buildAggregatedInstructions(servers);

      expect(result).toContain("Resources:");
      expect(result).toContain("(and 5 more)");
      expect(result).toContain("res://item_1");
      expect(result).toContain("res://item_10");
      expect(result).not.toContain("res://item_11,");
    });

    it("should include resource template names in output", () => {
      const servers = [
        {
          name: "template-server",
          resourceTemplateNames: ["users://{id}", "posts://{slug}"],
        },
      ];

      const result = preloader.buildAggregatedInstructions(servers);

      expect(result).toContain(
        "Resource templates: users://{id}, posts://{slug}",
      );
    });

    it("should truncate resource template list when exceeding limit", () => {
      const resourceTemplateNames = Array.from(
        { length: 12 },
        (_, i) => `tmpl://{id_${i + 1}}`,
      );
      const servers = [
        { name: "many-templates-server", resourceTemplateNames },
      ];

      const result = preloader.buildAggregatedInstructions(servers);

      expect(result).toContain("Resource templates:");
      expect(result).toContain("(and 2 more)");
    });

    it("should omit resources line when server has no resources", () => {
      const servers = [{ name: "no-res-server", resourceNames: [] }];

      const result = preloader.buildAggregatedInstructions(servers);

      expect(result).not.toContain("Resources:");
    });

    it("should omit resource templates line when server has no templates", () => {
      const servers = [
        { name: "no-tmpl-server", resourceTemplateNames: [] },
      ];

      const result = preloader.buildAggregatedInstructions(servers);

      expect(result).not.toContain("Resource templates:");
    });

    it("should handle undefined toolNames gracefully", () => {
      const servers = [
        {
          name: "legacy-server",
          serverName: "Legacy Server",
          // toolNames not provided (simulating failed tool fetch)
        },
      ];

      const result = preloader.buildAggregatedInstructions(servers);

      expect(result).toContain("## legacy-server");
      expect(result).not.toContain("Tools:");
    });
  });
});
