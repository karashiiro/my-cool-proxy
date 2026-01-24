import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, chmodSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { InvokeGatewaySkillScriptTool } from "./invoke-gateway-skill-script-tool.js";
import type { ILogger, ISkillDiscoveryService } from "../types/interfaces.js";
import type { SkillMetadata } from "../types/skill.js";

const isWindows = process.platform === "win32";

/**
 * Helper to write cross-platform test scripts.
 * Uses Node.js scripts that work on both Windows and Unix.
 * Returns the script filename to use.
 */
function writeNodeScript(
  dir: string,
  baseName: string,
  nodeCode: string,
): string {
  if (isWindows) {
    // On Windows, use a .cmd file that invokes node
    const scriptPath = resolve(dir, `${baseName}.cmd`);
    // Use %~dp0 to get the script directory and run node with the JS code
    // We write a companion .js file and call it from the .cmd
    const jsPath = resolve(dir, `${baseName}.js`);
    writeFileSync(jsPath, nodeCode);
    writeFileSync(scriptPath, `@node "%~dp0${baseName}.js" %*\r\n`);
    return `${baseName}.cmd`;
  } else {
    // On Unix, use a .mjs file with shebang
    const scriptPath = resolve(dir, `${baseName}.mjs`);
    writeFileSync(scriptPath, `#!/usr/bin/env node\n${nodeCode}`);
    chmodSync(scriptPath, "755");
    return `${baseName}.mjs`;
  }
}

describe("InvokeGatewaySkillScriptTool", () => {
  let tool: InvokeGatewaySkillScriptTool;
  let mockSkillService: ISkillDiscoveryService;
  let mockLogger: ILogger;
  let tempDir: string;
  let skillDir: string;
  let scriptsDir: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = resolve(
      tmpdir(),
      `invoke-script-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    skillDir = resolve(tempDir, "test-skill");
    scriptsDir = resolve(skillDir, "scripts");
    mkdirSync(scriptsDir, { recursive: true });

    mockSkillService = {
      discoverSkills: vi.fn(),
      getSkillContent: vi.fn(),
      getSkillResource: vi.fn(),
      clearCache: vi.fn(),
      ensureDefaultSkills: vi.fn(),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    tool = new InvokeGatewaySkillScriptTool(mockSkillService, mockLogger);
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.clearAllMocks();
  });

  describe("tool metadata", () => {
    it("should have correct name", () => {
      expect(tool.name).toBe("invoke-gateway-skill-script");
    });

    it("should have description mentioning script execution", () => {
      expect(tool.description).toContain("script");
      expect(tool.description).toContain("scripts/");
    });

    it("should have required schema fields", () => {
      expect(tool.schema.skillName).toBeDefined();
      expect(tool.schema.script).toBeDefined();
      expect(tool.schema.args).toBeDefined();
    });
  });

  describe("execute - skill not found", () => {
    it("should return error when skill does not exist", async () => {
      vi.mocked(mockSkillService.discoverSkills).mockResolvedValue([]);

      const result = await tool.execute({
        skillName: "nonexistent-skill",
        script: "test.sh",
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("nonexistent-skill");
      expect(text).toContain("not found");
    });
  });

  describe("execute - script validation", () => {
    const testSkill: SkillMetadata = {
      name: "test-skill",
      description: "Test skill",
      path: "", // Will be set in beforeEach
    };

    beforeEach(() => {
      testSkill.path = skillDir;
      vi.mocked(mockSkillService.discoverSkills).mockResolvedValue([testSkill]);
    });

    it("should reject script names with forward slashes", async () => {
      const result = await tool.execute({
        skillName: "test-skill",
        script: "subdir/test.sh",
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("only the filename");
    });

    it("should reject script names with backslashes", async () => {
      const result = await tool.execute({
        skillName: "test-skill",
        script: "subdir\\test.sh",
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("only the filename");
    });

    it("should return error when script does not exist", async () => {
      const result = await tool.execute({
        skillName: "test-skill",
        script: "nonexistent.sh",
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("not found");
    });

    it("should return error when script path is a directory", async () => {
      // Create a directory instead of a file
      mkdirSync(resolve(scriptsDir, "not-a-script"));

      const result = await tool.execute({
        skillName: "test-skill",
        script: "not-a-script",
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("not a file");
    });
  });

  describe("execute - successful script execution", () => {
    const testSkill: SkillMetadata = {
      name: "test-skill",
      description: "Test skill",
      path: "",
    };

    beforeEach(() => {
      testSkill.path = skillDir;
      vi.mocked(mockSkillService.discoverSkills).mockResolvedValue([testSkill]);
    });

    it("should execute a simple script and return stdout", async () => {
      const scriptName = writeNodeScript(
        scriptsDir,
        "hello",
        `console.log("Hello, World!");`,
      );

      const result = await tool.execute({
        skillName: "test-skill",
        script: scriptName,
      });

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Hello, World!");
      expect(text).toContain("exit code:** 0");
    });

    it("should pass arguments to script", async () => {
      const scriptName = writeNodeScript(
        scriptsDir,
        "echo-args",
        `console.log("Args: " + process.argv.slice(2).join(" "));`,
      );

      const result = await tool.execute({
        skillName: "test-skill",
        script: scriptName,
        args: ["foo", "bar", "baz"],
      });

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Args: foo bar baz");
    });

    it("should capture stderr", async () => {
      const scriptName = writeNodeScript(
        scriptsDir,
        "stderr",
        `console.error("error message");`,
      );

      const result = await tool.execute({
        skillName: "test-skill",
        script: scriptName,
      });

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("stderr");
      expect(text).toContain("error message");
    });

    it("should report non-zero exit codes as errors", async () => {
      const scriptName = writeNodeScript(
        scriptsDir,
        "failing",
        `process.exit(42);`,
      );

      const result = await tool.execute({
        skillName: "test-skill",
        script: scriptName,
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("exit code 42");
    });

    it("should set SKILL_DIR environment variable", async () => {
      const scriptName = writeNodeScript(
        scriptsDir,
        "env-check",
        `console.log("SKILL_DIR=" + process.env.SKILL_DIR);`,
      );

      const result = await tool.execute({
        skillName: "test-skill",
        script: scriptName,
      });

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain(`SKILL_DIR=${skillDir}`);
    });

    it("should use skill directory as working directory", async () => {
      const scriptName = writeNodeScript(
        scriptsDir,
        "pwd-check",
        `console.log(process.cwd());`,
      );

      const result = await tool.execute({
        skillName: "test-skill",
        script: scriptName,
      });

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain(skillDir);
    });
  });

  describe("logging", () => {
    const testSkill: SkillMetadata = {
      name: "test-skill",
      description: "Test skill",
      path: "",
    };

    beforeEach(() => {
      testSkill.path = skillDir;
      vi.mocked(mockSkillService.discoverSkills).mockResolvedValue([testSkill]);
    });

    it("should log info when executing script", async () => {
      const scriptName = writeNodeScript(
        scriptsDir,
        "log-test",
        `console.log("test");`,
      );

      await tool.execute({
        skillName: "test-skill",
        script: scriptName,
        args: ["arg1"],
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining(`test-skill/scripts/${scriptName}`),
      );
    });

    it("should log warning when skill not found", async () => {
      vi.mocked(mockSkillService.discoverSkills).mockResolvedValue([]);

      await tool.execute({
        skillName: "missing-skill",
        script: "test.sh",
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("missing-skill"),
      );
    });
  });

  describe("output formatting", () => {
    const testSkill: SkillMetadata = {
      name: "test-skill",
      description: "Test skill",
      path: "",
    };

    beforeEach(() => {
      testSkill.path = skillDir;
      vi.mocked(mockSkillService.discoverSkills).mockResolvedValue([testSkill]);
    });

    it("should format output with markdown code blocks", async () => {
      const scriptName = writeNodeScript(
        scriptsDir,
        "format",
        `console.log("output line");`,
      );

      const result = await tool.execute({
        skillName: "test-skill",
        script: scriptName,
      });

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("**stdout:**");
      expect(text).toContain("```");
    });

    it("should show only exit code when there is no output", async () => {
      const scriptName = writeNodeScript(
        scriptsDir,
        "silent",
        `process.exit(0);`,
      );

      const result = await tool.execute({
        skillName: "test-skill",
        script: scriptName,
      });

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("no output");
      expect(text).toContain("exit code 0");
    });
  });
});
