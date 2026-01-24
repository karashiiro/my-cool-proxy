import { injectable } from "inversify";
import * as z from "zod";
import { spawn } from "child_process";
import { resolve } from "path";
import { existsSync, statSync } from "fs";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ITool } from "./base-tool.js";
import type { ILogger, ISkillDiscoveryService } from "../types/interfaces.js";

/** Default timeout for script execution (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30000;

/** Maximum timeout allowed (5 minutes) */
const MAX_TIMEOUT_MS = 300000;

/**
 * Tool that executes scripts from a gateway skill's scripts/ directory.
 *
 * Scripts are executed via shell with the skill directory as the working directory,
 * allowing them to access references/ and assets/ via relative paths.
 */
@injectable()
export class InvokeGatewaySkillScriptTool implements ITool {
  readonly name = "invoke-gateway-skill-script";
  readonly description =
    "Execute a script from a gateway skill's scripts/ directory. Scripts run with " +
    "the skill directory as the working directory, so they can access references/ " +
    "and assets/ via relative paths. Returns stdout, stderr, and exit code.";

  readonly schema = {
    skillName: z
      .string()
      .describe("The name of the skill containing the script"),
    script: z
      .string()
      .describe(
        "The script filename within the scripts/ directory (e.g., 'extract.py', 'process.sh')",
      ),
    args: z
      .array(z.string())
      .optional()
      .describe("Optional arguments to pass to the script"),
    timeout: z
      .number()
      .optional()
      .describe(
        `Optional timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}, max: ${MAX_TIMEOUT_MS})`,
      ),
  };

  constructor(
    @$inject(TYPES.SkillDiscoveryService)
    private skillService: ISkillDiscoveryService,
    @$inject(TYPES.Logger) private logger: ILogger,
  ) {}

  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const {
      skillName,
      script,
      args: scriptArgs = [],
      timeout = DEFAULT_TIMEOUT_MS,
    } = args as {
      skillName: string;
      script: string;
      args?: string[];
      timeout?: number;
    };

    // Validate timeout
    const effectiveTimeout = Math.min(Math.max(timeout, 0), MAX_TIMEOUT_MS);

    // Find the skill
    const skills = await this.skillService.discoverSkills();
    const skill = skills.find((s) => s.name === skillName);

    if (!skill) {
      this.logger.warn(`Skill not found for script execution: ${skillName}`);
      return {
        content: [
          {
            type: "text",
            text: `Skill '${skillName}' not found. Check the available gateway skills in the server instructions.`,
          },
        ],
        isError: true,
      };
    }

    // Security: Validate script path
    // 1. Script name should not contain path separators (prevent scripts/../foo)
    if (script.includes("/") || script.includes("\\")) {
      this.logger.warn(
        `Invalid script name (contains path separator): ${script}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `Invalid script name: '${script}'. Provide only the filename, not a path.`,
          },
        ],
        isError: true,
      };
    }

    // 2. Resolve the full path and verify it's in scripts/
    const scriptsDir = resolve(skill.path, "scripts");
    const scriptPath = resolve(scriptsDir, script);

    // 3. Verify the resolved path is still within scripts/
    // The script must be directly inside scripts/, not equal to it or outside it
    if (!scriptPath.startsWith(scriptsDir + "/")) {
      this.logger.warn(`Path traversal attempt in script name: ${script}`);
      return {
        content: [
          {
            type: "text",
            text: `Invalid script name: '${script}'`,
          },
        ],
        isError: true,
      };
    }

    // 4. Check if the script exists and is a file
    if (!existsSync(scriptPath)) {
      this.logger.warn(`Script not found: ${scriptPath}`);
      return {
        content: [
          {
            type: "text",
            text:
              `Script '${script}' not found in skill '${skillName}'. ` +
              `Make sure the script exists in the scripts/ directory.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const stats = statSync(scriptPath);
      if (!stats.isFile()) {
        return {
          content: [
            {
              type: "text",
              text: `'${script}' is not a file.`,
            },
          ],
          isError: true,
        };
      }
    } catch {
      return {
        content: [
          {
            type: "text",
            text: `Cannot access script '${script}'.`,
          },
        ],
        isError: true,
      };
    }

    // Execute the script
    this.logger.info(
      `Executing skill script: ${skillName}/scripts/${script} with args: ${JSON.stringify(scriptArgs)}`,
    );

    try {
      const result = await this.executeScript(
        scriptPath,
        scriptArgs,
        skill.path,
        effectiveTimeout,
      );

      return {
        content: [
          {
            type: "text",
            text: this.formatResult(result),
          },
        ],
        isError: result.exitCode !== 0,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Script execution failed: ${errorMessage}`);
      return {
        content: [
          {
            type: "text",
            text: `Script execution failed: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  private executeScript(
    scriptPath: string,
    args: string[],
    cwd: string,
    timeout: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(scriptPath, args, {
        cwd,
        shell: true,
        timeout,
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

      proc.on("close", (code, signal) => {
        if (signal === "SIGTERM") {
          reject(new Error(`Script timed out after ${timeout}ms`));
        } else {
          resolve({
            stdout,
            stderr,
            exitCode: code ?? 1,
          });
        }
      });
    });
  }

  private formatResult(result: {
    stdout: string;
    stderr: string;
    exitCode: number;
  }): string {
    const parts: string[] = [];

    if (result.stdout) {
      parts.push(`**stdout:**\n\`\`\`\n${result.stdout.trim()}\n\`\`\``);
    }

    if (result.stderr) {
      parts.push(`**stderr:**\n\`\`\`\n${result.stderr.trim()}\n\`\`\``);
    }

    parts.push(`**exit code:** ${result.exitCode}`);

    if (parts.length === 1) {
      // Only exit code, no output
      return `Script completed with exit code ${result.exitCode} (no output)`;
    }

    return parts.join("\n\n");
  }
}
