import { injectable } from "inversify";
import { spawn } from "child_process";
import { resolve, sep, dirname } from "path";
import { existsSync, statSync, mkdirSync, writeFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { getErrorMessage } from "@my-cool-proxy/mcp-utilities";
import type { ILogger, ISkillDiscoveryService } from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import { getSkillsDir, SKILL_FILENAME } from "../utils/skills.js";

/**
 * Regular expression to extract YAML frontmatter from a markdown file.
 * Matches content between opening and closing `---` delimiters at the start of the file.
 */
const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/**
 * Expected shape of skill frontmatter after YAML parsing.
 */
interface SkillFrontmatter {
  name?: string;
  description?: string;
}

/**
 * Service for executing and writing gateway skills.
 * Encapsulates skill script execution and skill file writing logic,
 * previously private methods of ExecuteLuaTool.
 */
@injectable()
export class SkillOperationsService {
  constructor(
    @$inject(TYPES.Logger) private logger: ILogger,
    @$inject(TYPES.SkillDiscoveryService)
    private skillDiscovery: ISkillDiscoveryService,
  ) {}

  /**
   * Execute a script from a skill's scripts/ directory.
   * Adapted from InvokeGatewaySkillScriptTool.
   */
  async executeSkillScript(
    skillName: string,
    script: string,
    scriptArgs: string[],
  ): Promise<unknown> {
    // Find the skill
    const skills = await this.skillDiscovery.discoverSkills();
    const skill = skills.find((s) => s.name === skillName);

    if (!skill) {
      this.logger.warn(`Skill not found for script execution: ${skillName}`);
      return {
        error: `Skill '${skillName}' not found. Check the available gateway skills.`,
      };
    }

    // Security: Validate script path
    if (script.includes("/") || script.includes("\\")) {
      this.logger.warn(
        `Invalid script name (contains path separator): ${script}`,
      );
      return {
        error: `Invalid script name: '${script}'. Provide only the filename, not a path.`,
      };
    }

    // Resolve the full path and verify it's in scripts/
    const scriptsDir = resolve(skill.path, "scripts");
    const scriptPath = resolve(scriptsDir, script);

    // Verify the resolved path is still within scripts/
    if (!scriptPath.startsWith(scriptsDir + sep)) {
      this.logger.warn(`Path traversal attempt in script name: ${script}`);
      return { error: `Invalid script name: '${script}'` };
    }

    // Check if the script exists and is a file
    if (!existsSync(scriptPath)) {
      this.logger.warn(`Script not found: ${scriptPath}`);
      return {
        error:
          `Script '${script}' not found in skill '${skillName}'. ` +
          `Make sure the script exists in the scripts/ directory.`,
      };
    }

    try {
      const stats = statSync(scriptPath);
      if (!stats.isFile()) {
        return { error: `'${script}' is not a file.` };
      }
    } catch {
      return { error: `Cannot access script '${script}'.` };
    }

    // Execute the script
    this.logger.info(
      `Executing skill script: ${skillName}/scripts/${script} with args: ${JSON.stringify(scriptArgs)}`,
    );

    try {
      const result = await this.runScript(scriptPath, scriptArgs, skill.path);
      return {
        stdout: result.stdout || undefined,
        stderr: result.stderr || undefined,
        exitCode: result.exitCode,
        success: result.exitCode === 0,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Script execution failed: ${errorMessage}`);
      return { error: `Script execution failed: ${errorMessage}` };
    }
  }

  /**
   * Create or modify a gateway skill.
   * Adapted from WriteGatewaySkillTool.
   */
  async writeSkillFiles(
    skillName: string,
    content?: string,
    files?: Array<{ path: string; content: string }>,
  ): Promise<unknown> {
    // Validate that at least one of content or files is provided
    if (!content && (!files || files.length === 0)) {
      return {
        error:
          "At least one of 'content' (SKILL.md) or 'files' must be provided.",
      };
    }

    // Validate skill name (no path separators allowed)
    if (skillName.includes("/") || skillName.includes("\\")) {
      return {
        error: `Skill name '${skillName}' cannot contain path separators.`,
      };
    }

    // Validate frontmatter if content is provided
    if (content) {
      const frontmatterError = this.validateFrontmatter(content);
      if (frontmatterError) {
        return { error: frontmatterError };
      }
    }

    // Validate file paths (no path traversal)
    if (files) {
      for (const file of files) {
        const pathError = this.validateFilePath(file.path);
        if (pathError) {
          return { error: pathError };
        }
      }
    }

    try {
      // Create skill directory
      const skillsDir = getSkillsDir();
      const skillDir = resolve(skillsDir, skillName);

      // Ensure the skill directory exists
      if (!existsSync(skillDir)) {
        mkdirSync(skillDir, { recursive: true });
        this.logger.info(`Created skill directory: ${skillDir}`);
      }

      const writtenFiles: string[] = [];

      // Write SKILL.md if content is provided
      if (content) {
        const skillFilePath = resolve(skillDir, SKILL_FILENAME);
        writeFileSync(skillFilePath, content, "utf-8");
        writtenFiles.push(SKILL_FILENAME);
        this.logger.info(`Wrote SKILL.md for skill: ${skillName}`);
      }

      // Write additional files
      if (files) {
        for (const file of files) {
          const filePath = resolve(skillDir, file.path);
          const fileDir = dirname(filePath);

          // Ensure parent directory exists
          if (!existsSync(fileDir)) {
            mkdirSync(fileDir, { recursive: true });
          }

          writeFileSync(filePath, file.content, "utf-8");
          writtenFiles.push(file.path);
          this.logger.debug(`Wrote skill file: ${skillName}/${file.path}`);
        }
      }

      // Extract metadata from content or discover
      const metadata = await this.getSkillMetadata(
        skillName,
        skillDir,
        content,
      );

      this.logger.info(
        `Created/updated skill '${skillName}' with ${writtenFiles.length} file(s)`,
      );

      return {
        success: true,
        skill: {
          name: metadata.name,
          description: metadata.description,
        },
        writtenFiles,
        note:
          "Skill created successfully. It can be loaded immediately, " +
          "but won't appear in server instructions until the gateway is restarted.",
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(
        `Failed to write skill '${skillName}': ${errorMessage}`,
      );
      return { error: `Error writing skill: ${errorMessage}` };
    }
  }

  /**
   * Validate that content has valid YAML frontmatter.
   */
  validateFrontmatter(content: string): string | undefined {
    const match = content.match(FRONTMATTER_REGEX);
    if (!match) {
      return (
        "SKILL.md content must include YAML frontmatter. " +
        "Expected format:\n---\nname: My Skill\ndescription: What it does\n---\n\n# Content here"
      );
    }

    const frontmatterYaml = match[1]!;
    try {
      const parsed = parseYaml(frontmatterYaml) as SkillFrontmatter;
      if (!parsed || typeof parsed !== "object") {
        return "YAML frontmatter is empty or not an object.";
      }
      // At least one of name or description should be present
      if (!parsed.name && !parsed.description) {
        return "YAML frontmatter should include at least a 'name' or 'description' field.";
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      return `Invalid YAML in frontmatter: ${errorMessage}`;
    }

    return undefined;
  }

  /**
   * Validate that a file path is safe (no path traversal).
   */
  validateFilePath(path: string): string | undefined {
    // Normalize path separators for the check
    const normalizedPath = path.replace(/\\/g, "/");

    // Check for path traversal attempts
    if (
      normalizedPath.startsWith("/") ||
      normalizedPath.startsWith("..") ||
      normalizedPath.includes("/../") ||
      normalizedPath.includes("/..") ||
      normalizedPath.endsWith("/..")
    ) {
      return `Invalid path '${path}' - path traversal is not allowed.`;
    }

    // Check for absolute Windows paths
    if (/^[a-zA-Z]:/.test(path)) {
      return `Invalid path '${path}' - absolute paths are not allowed.`;
    }

    return undefined;
  }

  /**
   * Get skill metadata either from provided content or by re-discovering.
   */
  async getSkillMetadata(
    skillName: string,
    skillDir: string,
    content?: string,
  ): Promise<{ name: string; description: string; path: string }> {
    // If content was provided, extract metadata from it
    if (content) {
      const match = content.match(FRONTMATTER_REGEX);
      if (match) {
        try {
          const parsed = parseYaml(match[1]!) as SkillFrontmatter;
          return {
            name: parsed?.name || skillName,
            description: parsed?.description || "",
            path: skillDir,
          };
        } catch {
          // Fall through to default
        }
      }
    }

    // Try to discover from existing SKILL.md
    const skills = await this.skillDiscovery.discoverSkills();
    const discovered = skills.find(
      (s) => s.name === skillName || s.path === skillDir,
    );
    if (discovered) {
      return discovered;
    }

    // Return minimal metadata
    return {
      name: skillName,
      description: "",
      path: skillDir,
    };
  }

  /**
   * Run a script via shell.
   */
  private runScript(
    scriptPath: string,
    args: string[],
    cwd: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(scriptPath, args, {
        cwd,
        shell: true,
        env: {
          ...process.env,
          SKILL_DIR: cwd,
        },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (error) => {
        reject(error);
      });

      proc.on("close", (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });
    });
  }
}
