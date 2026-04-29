import { injectable } from "inversify";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import {
  existsSync,
  statSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { getErrorMessage } from "@my-cool-proxy/mcp-utilities";
import type { ILogger, ISkillDiscoveryService } from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import { getSkillsDir, SKILL_FILENAME } from "../utils/skills.js";
import { parseFrontmatter } from "./skill-frontmatter-parser.js";
import { isSafePathComponent, resolveAndValidate } from "./path-validator.js";

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

    // Security: Validate script path component
    if (!isSafePathComponent(script)) {
      this.logger.warn(
        `Invalid script name (contains path separator): ${script}`,
      );
      return {
        error: `Invalid script name: '${script}'. Provide only the filename, not a path.`,
      };
    }

    // Resolve the full path and verify it's in scripts/
    const scriptsDir = resolve(skill.path, "scripts");
    let scriptPath: string;
    try {
      scriptPath = resolveAndValidate(scriptsDir, script);
    } catch {
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
  // eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity, complexity
  async writeSkillFiles(
    skillName: string,
    content?: string,
    files?: Array<{ path: string; content: string }>,
  ): Promise<unknown> {
    // Validate that files is an array when provided (Lua tables may arrive as plain objects)
    if (files != null && !Array.isArray(files)) {
      return {
        error: "'files' must be an array of { path, content } objects.",
      };
    }

    // Validate that at least one of content or files is provided
    if (!content && (!files || files.length === 0)) {
      return {
        error:
          "At least one of 'content' (SKILL.md) or 'files' must be provided.",
      };
    }

    // Validate skill name (no path separators allowed)
    if (!isSafePathComponent(skillName)) {
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
   * Partially update an existing skill file using old_string/new_string replacement.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async updateSkillFile(
    skillName: string,
    file: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): Promise<unknown> {
    // Validate skill name (no path separators allowed)
    if (!isSafePathComponent(skillName)) {
      return {
        error: `Skill name '${skillName}' cannot contain path separators.`,
      };
    }

    // Validate file path
    const pathError = this.validateFilePath(file);
    if (pathError) {
      return { error: pathError };
    }

    // Resolve full path and verify it stays within skill directory
    const skillsDir = getSkillsDir();
    const skillDir = resolve(skillsDir, skillName);
    let filePath: string;
    try {
      filePath = resolveAndValidate(skillDir, file);
    } catch {
      return { error: `Invalid file path: '${file}'` };
    }

    // Check file exists
    if (!existsSync(filePath)) {
      return {
        error: `File '${file}' not found in skill '${skillName}'. Use write_skill to create new files.`,
      };
    }

    try {
      const content = readFileSync(filePath, "utf-8");

      // Count occurrences
      let count = 0;
      let searchFrom = 0;
      while (true) {
        const idx = content.indexOf(oldString, searchFrom);
        if (idx === -1) break;
        count++;
        searchFrom = idx + oldString.length;
      }

      if (count === 0) {
        return { error: "old_string not found in file." };
      }

      if (count > 1 && !replaceAll) {
        return {
          error: `old_string found ${count} times. Use replace_all: true to replace all occurrences, or provide a more specific old_string.`,
        };
      }

      // Perform replacement using function replacer to avoid special $-pattern
      // interpretation in newString (e.g. $&, $`, $', $1 would otherwise be
      // treated as back-references rather than literal text).
      let updated: string;
      if (replaceAll) {
        updated = content.replaceAll(oldString, () => newString);
      } else {
        updated = content.replace(oldString, () => newString);
      }

      // Validate frontmatter if editing SKILL.md
      if (file === SKILL_FILENAME) {
        const frontmatterError = this.validateFrontmatter(updated);
        if (frontmatterError) {
          return {
            error: `Replacement would break SKILL.md frontmatter: ${frontmatterError}`,
          };
        }
      }

      writeFileSync(filePath, updated, "utf-8");

      this.logger.info(
        `Updated skill file '${skillName}/${file}' (${count} replacement${count > 1 ? "s" : ""})`,
      );

      return {
        success: true,
        file,
        replacements: count,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(
        `Failed to update skill file '${skillName}/${file}': ${errorMessage}`,
      );
      return { error: `Error updating skill file: ${errorMessage}` };
    }
  }

  /**
   * Validate that content has valid YAML frontmatter.
   */
  validateFrontmatter(content: string): string | undefined {
    const result = parseFrontmatter(content);
    if (!result.ok) {
      if (result.error === "no_frontmatter") {
        return (
          "SKILL.md content must include YAML frontmatter. " +
          "Expected format:\n---\nname: My Skill\ndescription: What it does\n---\n\n# Content here"
        );
      }
      if (result.error === "empty_or_non_object") {
        return "YAML frontmatter is empty or not an object.";
      }
      // Invalid YAML or other parse errors
      return result.error;
    }

    // At least one of name or description should be present
    if (!result.frontmatter.name && !result.frontmatter.description) {
      return "YAML frontmatter should include at least a 'name' or 'description' field.";
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
      const result = parseFrontmatter(content);
      if (result.ok) {
        return {
          name: result.frontmatter.name || skillName,
          description: result.frontmatter.description || "",
          path: skillDir,
        };
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
