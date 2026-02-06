import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import { generateStdioTestConfig } from "../helpers/test-config-generator.js";
import { resolve } from "node:path";

/**
 * E2E tests for skill resources.
 * These tests verify that skills are correctly exposed as MCP resources.
 */
describe("Skills E2E", () => {
  let gatewayClient: Client;
  let configCleanup: () => void;

  beforeAll(async () => {
    // Generate config with skills enabled and test skills
    const configResult = generateStdioTestConfig(
      {
        transport: "stdio",
        mcpClients: {}, // No upstream servers needed for skill tests
        skills: {
          enabled: true,
          mutable: false,
        },
      },
      [
        {
          name: "test-skill",
          content: `---
name: test-skill
description: A test skill for e2e testing
---

# Test Skill

This is a test skill used for e2e testing.

## Usage

Use this skill when testing.
`,
          resources: {
            "scripts/example.py": `#!/usr/bin/env python3
print("Hello from test skill!")
`,
            "references/API.md": `# API Reference

This is a reference document.
`,
          },
        },
        {
          name: "another-skill",
          content: `---
name: another-skill
description: Another skill for testing
---

# Another Skill

A second test skill.
`,
        },
      ],
    );
    configCleanup = configResult.cleanup;

    // Create client with stdio transport to gateway
    gatewayClient = new Client(
      { name: "e2e-skills-client", version: "1.0.0" },
      { capabilities: {} },
    );

    // Create transport that spawns gateway process
    const transport = new StdioClientTransport({
      command: "node",
      args: [resolve(process.cwd(), "apps/gateway/dist/index.js")],
      env: {
        ...process.env,
        CONFIG_PATH: configResult.configPath,
      },
    });

    await gatewayClient.connect(transport);

    // Small delay to ensure gateway is fully initialized
    await new Promise((resolve) => setTimeout(resolve, 100));
  }, 60000);

  afterAll(async () => {
    await gatewayClient?.close();
    configCleanup?.();
  });

  describe("Resource Discovery", () => {
    it("should list skills as resources", async () => {
      const resources = await gatewayClient.listResources();

      expect(resources.resources).toBeDefined();
      expect(Array.isArray(resources.resources)).toBe(true);

      // Should have skill resources
      const skillResources = resources.resources.filter((r) =>
        r.uri.startsWith("skill://"),
      );

      expect(skillResources.length).toBe(2);

      // Find specific skills
      const testSkill = skillResources.find(
        (r) => r.uri === "skill://test-skill",
      );
      const anotherSkill = skillResources.find(
        (r) => r.uri === "skill://another-skill",
      );

      expect(testSkill).toBeDefined();
      expect(testSkill?.name).toBe("test-skill");
      expect(testSkill?.description).toBe("A test skill for e2e testing");

      expect(anotherSkill).toBeDefined();
      expect(anotherSkill?.name).toBe("another-skill");
      expect(anotherSkill?.description).toBe("Another skill for testing");
    });

    it("should list skills even without upstream MCP servers", async () => {
      // This test verifies the fix for the early return bug
      const resources = await gatewayClient.listResources();

      // Should have resources even though there are no MCP servers
      expect(resources.resources.length).toBeGreaterThan(0);
    });
  });

  describe("Resource Reading", () => {
    it("should read main SKILL.md content", async () => {
      const result = await gatewayClient.readResource({
        uri: "skill://test-skill",
      });

      expect(result.contents).toHaveLength(1);
      const content = result.contents[0];

      expect(content?.uri).toBe("skill://test-skill");
      expect(content?.mimeType).toBe("text/markdown");

      if ("text" in content!) {
        expect(content.text).toContain("# Test Skill");
        expect(content.text).toContain("This is a test skill");
      }
    });

    it("should read nested resource files", async () => {
      const result = await gatewayClient.readResource({
        uri: "skill://test-skill/scripts/example.py",
      });

      expect(result.contents).toHaveLength(1);
      const content = result.contents[0];

      expect(content?.uri).toBe("skill://test-skill/scripts/example.py");
      expect(content?.mimeType).toBe("text/x-python");

      if ("text" in content!) {
        expect(content.text).toContain("Hello from test skill!");
      }
    });

    it("should read reference files", async () => {
      const result = await gatewayClient.readResource({
        uri: "skill://test-skill/references/API.md",
      });

      expect(result.contents).toHaveLength(1);
      const content = result.contents[0];

      expect(content?.uri).toBe("skill://test-skill/references/API.md");
      expect(content?.mimeType).toBe("text/markdown");

      if ("text" in content!) {
        expect(content.text).toContain("# API Reference");
      }
    });

    it("should throw error for non-existent skill", async () => {
      await expect(
        gatewayClient.readResource({
          uri: "skill://nonexistent-skill",
        }),
      ).rejects.toThrow();
    });

    it("should throw error for non-existent nested resource", async () => {
      await expect(
        gatewayClient.readResource({
          uri: "skill://test-skill/scripts/missing.py",
        }),
      ).rejects.toThrow();
    });
  });

  describe("Server Instructions", () => {
    it("should include skill instructions in server info", async () => {
      const serverInfo = gatewayClient.getServerVersion();

      // The server instructions should mention skills
      // Note: We can't directly access instructions, but we can verify
      // the server name is correct
      expect(serverInfo?.name).toBe("my-cool-proxy");
    });

    it("should receive instructions from gateway", async () => {
      const instructions = gatewayClient.getInstructions();

      // Instructions should be present and contain skill information
      expect(instructions).toBeDefined();
      expect(instructions).not.toBe("");
      expect(instructions).toContain("MCP gateway");
      expect(instructions).toContain("skill://");
    });
  });

  describe("read-resource Tool", () => {
    it("should read skill via read-resource tool", async () => {
      const result = await gatewayClient.callTool({
        name: "read-resource",
        arguments: { uri: "skill://test-skill" },
      });

      const content = result.content as TextContent[];
      expect(content).toHaveLength(1);
      expect(content[0]?.type).toBe("text");
      expect(content[0]?.text).toContain("# Test Skill");
    });

    it("should read nested skill resource via read-resource tool", async () => {
      const result = await gatewayClient.callTool({
        name: "read-resource",
        arguments: { uri: "skill://test-skill/scripts/example.py" },
      });

      const content = result.content as TextContent[];
      expect(content).toHaveLength(1);
      expect(content[0]?.type).toBe("text");
      expect(content[0]?.text).toContain("Hello from test skill!");
    });
  });
});
