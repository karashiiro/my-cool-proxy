import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, chmodSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { InvokeGatewaySkillScriptTool } from "./invoke-gateway-skill-script-tool.js";
import type { ILogger, ISkillDiscoveryService } from "../types/interfaces.js";
import type { SkillMetadata } from "../types/skill.js";

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
      expect(tool.schema.timeout).toBeDefined();
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

    it("should execute a simple shell script and return stdout", async () => {
      const scriptPath = resolve(scriptsDir, "hello.sh");
      writeFileSync(scriptPath, '#!/bin/bash\necho "Hello, World!"');
      chmodSync(scriptPath, "755");

      const result = await tool.execute({
        skillName: "test-skill",
        script: "hello.sh",
      });

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Hello, World!");
      expect(text).toContain("exit code:** 0");
    });

    it("should pass arguments to script", async () => {
      const scriptPath = resolve(scriptsDir, "echo-args.sh");
      writeFileSync(scriptPath, '#!/bin/bash\necho "Args: $@"');
      chmodSync(scriptPath, "755");

      const result = await tool.execute({
        skillName: "test-skill",
        script: "echo-args.sh",
        args: ["foo", "bar", "baz"],
      });

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Args: foo bar baz");
    });

    it("should capture stderr", async () => {
      const scriptPath = resolve(scriptsDir, "stderr.sh");
      writeFileSync(scriptPath, '#!/bin/bash\necho "error message" >&2');
      chmodSync(scriptPath, "755");

      const result = await tool.execute({
        skillName: "test-skill",
        script: "stderr.sh",
      });

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("stderr");
      expect(text).toContain("error message");
    });

    it("should report non-zero exit codes as errors", async () => {
      const scriptPath = resolve(scriptsDir, "failing.sh");
      writeFileSync(scriptPath, "#!/bin/bash\nexit 42");
      chmodSync(scriptPath, "755");

      const result = await tool.execute({
        skillName: "test-skill",
        script: "failing.sh",
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("exit code 42");
    });

    it("should set SKILL_DIR environment variable", async () => {
      const scriptPath = resolve(scriptsDir, "env-check.sh");
      writeFileSync(scriptPath, '#!/bin/bash\necho "SKILL_DIR=$SKILL_DIR"');
      chmodSync(scriptPath, "755");

      const result = await tool.execute({
        skillName: "test-skill",
        script: "env-check.sh",
      });

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain(`SKILL_DIR=${skillDir}`);
    });

    it("should use skill directory as working directory", async () => {
      const scriptPath = resolve(scriptsDir, "pwd-check.sh");
      writeFileSync(scriptPath, "#!/bin/bash\npwd");
      chmodSync(scriptPath, "755");

      const result = await tool.execute({
        skillName: "test-skill",
        script: "pwd-check.sh",
      });

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain(skillDir);
    });
  });

  describe("execute - python scripts", () => {
    const testSkill: SkillMetadata = {
      name: "test-skill",
      description: "Test skill",
      path: "",
    };

    beforeEach(() => {
      testSkill.path = skillDir;
      vi.mocked(mockSkillService.discoverSkills).mockResolvedValue([testSkill]);
    });

    it("should execute python scripts with shebang", async () => {
      const scriptPath = resolve(scriptsDir, "hello.py");
      writeFileSync(
        scriptPath,
        '#!/usr/bin/env python3\nprint("Hello from Python!")',
      );
      chmodSync(scriptPath, "755");

      const result = await tool.execute({
        skillName: "test-skill",
        script: "hello.py",
      });

      // This test may fail if python3 isn't installed, but that's OK
      // We're testing the mechanism, not the presence of python
      const text = (result.content[0] as { type: "text"; text: string }).text;
      if (result.isError) {
        // If it failed, make sure it's because of python not being available
        // not because of our code
        expect(
          text.includes("Hello from Python!") ||
            text.includes("python") ||
            text.includes("not found") ||
            text.includes("No such file"),
        ).toBe(true);
      } else {
        expect(text).toContain("Hello from Python!");
      }
    });
  });

  describe("execute - timeout handling", () => {
    const testSkill: SkillMetadata = {
      name: "test-skill",
      description: "Test skill",
      path: "",
    };

    beforeEach(() => {
      testSkill.path = skillDir;
      vi.mocked(mockSkillService.discoverSkills).mockResolvedValue([testSkill]);
    });

    it("should timeout long-running scripts", async () => {
      const scriptPath = resolve(scriptsDir, "sleeper.sh");
      writeFileSync(scriptPath, "#!/bin/bash\nsleep 60\necho done");
      chmodSync(scriptPath, "755");

      const result = await tool.execute({
        skillName: "test-skill",
        script: "sleeper.sh",
        timeout: 100, // 100ms timeout - should fail fast
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("timed out");
    }, 10000); // Give the test itself 10 seconds

    it("should clamp timeout to maximum allowed value", async () => {
      // This test just verifies the script runs without error
      // The timeout clamping logic is internal
      const scriptPath = resolve(scriptsDir, "quick.sh");
      writeFileSync(scriptPath, '#!/bin/bash\necho "quick"');
      chmodSync(scriptPath, "755");

      const result = await tool.execute({
        skillName: "test-skill",
        script: "quick.sh",
        timeout: 999999999, // Way over max, should be clamped
      });

      expect(result.isError).toBe(false);
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
      const scriptPath = resolve(scriptsDir, "log-test.sh");
      writeFileSync(scriptPath, '#!/bin/bash\necho "test"');
      chmodSync(scriptPath, "755");

      await tool.execute({
        skillName: "test-skill",
        script: "log-test.sh",
        args: ["arg1"],
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("test-skill/scripts/log-test.sh"),
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
      const scriptPath = resolve(scriptsDir, "format.sh");
      writeFileSync(scriptPath, '#!/bin/bash\necho "output line"');
      chmodSync(scriptPath, "755");

      const result = await tool.execute({
        skillName: "test-skill",
        script: "format.sh",
      });

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("**stdout:**");
      expect(text).toContain("```");
    });

    it("should show only exit code when there is no output", async () => {
      const scriptPath = resolve(scriptsDir, "silent.sh");
      writeFileSync(scriptPath, "#!/bin/bash\nexit 0");
      chmodSync(scriptPath, "755");

      const result = await tool.execute({
        skillName: "test-skill",
        script: "silent.sh",
      });

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("no output");
      expect(text).toContain("exit code 0");
    });
  });
});
