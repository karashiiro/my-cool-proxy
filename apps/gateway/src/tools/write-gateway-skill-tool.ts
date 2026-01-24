import { injectable } from "inversify";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { parse as parseYaml } from "yaml";
import * as z from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ITool } from "./base-tool.js";
import type { ILogger } from "../types/interfaces.js";
import type { ISkillDiscoveryService, SkillMetadata } from "../types/skill.js";
import { getSkillsDir, SKILL_FILENAME } from "../utils/skills-paths.js";

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
 * Tool that creates or overwrites a gateway skill and its files.
 *
 * This tool allows agents to dynamically create skills that can be loaded
 * by other agents using load-gateway-skill. Note that newly created skills
 * won't appear in server instructions until the gateway is restarted, but
 * they can still be loaded directly by name.
 */
@injectable()
export class WriteGatewaySkillTool implements ITool {
  readonly name = "write-gateway-skill";
  readonly description =
    "Create or overwrite a gateway skill and its files. Skills are stored locally and " +
    "can be loaded using load-gateway-skill. Note: Newly created skills won't appear in " +
    "server instructions until the gateway is restarted, but can still be loaded by name. " +
    "Returns the skill metadata upon successful creation.";

  readonly schema = {
    skillName: z
      .string()
      .describe(
        "The name of the skill. Used as the directory name. Should be kebab-case (e.g., 'my-awesome-skill').",
      ),
    content: z
      .string()
      .optional()
      .describe(
        "The full SKILL.md content including YAML frontmatter. " +
          "If provided, creates or overwrites the SKILL.md file. " +
          "Must include valid YAML frontmatter with at least a 'name' or 'description' field.",
      ),
    files: z
      .array(
        z.object({
          path: z
            .string()
            .describe(
              "Relative path within the skill directory (e.g., 'scripts/extract.py', 'references/API.md')",
            ),
          content: z.string().describe("Content to write to the file"),
        }),
      )
      .optional()
      .describe(
        "Additional resource files to create or overwrite within the skill directory. " +
          "Typically stored in scripts/, references/, or assets/ subdirectories.",
      ),
  };

  constructor(
    @$inject(TYPES.SkillDiscoveryService)
    private skillService: ISkillDiscoveryService,
    @$inject(TYPES.Logger) private logger: ILogger,
  ) {}

  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const { skillName, content, files } = args as {
      skillName: string;
      content?: string;
      files?: Array<{ path: string; content: string }>;
    };

    // Validate that at least one of content or files is provided
    if (!content && (!files || files.length === 0)) {
      return {
        content: [
          {
            type: "text",
            text: "Error: At least one of 'content' (SKILL.md) or 'files' must be provided.",
          },
        ],
        isError: true,
      };
    }

    // Validate skill name (no path separators allowed)
    if (skillName.includes("/") || skillName.includes("\\")) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Skill name '${skillName}' cannot contain path separators.`,
          },
        ],
        isError: true,
      };
    }

    // Validate frontmatter if content is provided
    if (content) {
      const frontmatterError = this.validateFrontmatter(content);
      if (frontmatterError) {
        return {
          content: [
            {
              type: "text",
              text: frontmatterError,
            },
          ],
          isError: true,
        };
      }
    }

    // Validate file paths (no path traversal)
    if (files) {
      for (const file of files) {
        const pathError = this.validateFilePath(file.path);
        if (pathError) {
          return {
            content: [
              {
                type: "text",
                text: pathError,
              },
            ],
            isError: true,
          };
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

      // Clear the skills cache so fresh discovery happens on next access
      this.skillService.clearCache();

      // Build the response with skill metadata (excluding internal path)
      const metadata = await this.getSkillMetadata(
        skillName,
        skillDir,
        content,
      );
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { path: _path, ...skillInfo } = metadata;

      const response = {
        success: true,
        skill: skillInfo,
        writtenFiles,
        note:
          "Skill created successfully. It can be loaded immediately using load-gateway-skill, " +
          "but won't appear in server instructions until the gateway is restarted.",
      };

      this.logger.info(
        `Created/updated skill '${skillName}' with ${writtenFiles.length} file(s)`,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to write skill '${skillName}': ${errorMessage}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `Error writing skill: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Validate that content has valid YAML frontmatter.
   * @returns Error message if invalid, undefined if valid
   */
  private validateFrontmatter(content: string): string | undefined {
    const match = content.match(FRONTMATTER_REGEX);
    if (!match) {
      return (
        "Error: SKILL.md content must include YAML frontmatter. " +
        "Expected format:\n---\nname: My Skill\ndescription: What it does\n---\n\n# Content here"
      );
    }

    const frontmatterYaml = match[1]!;
    try {
      const parsed = parseYaml(frontmatterYaml) as SkillFrontmatter;
      if (!parsed || typeof parsed !== "object") {
        return "Error: YAML frontmatter is empty or not an object.";
      }
      // At least one of name or description should be present
      if (!parsed.name && !parsed.description) {
        return "Error: YAML frontmatter should include at least a 'name' or 'description' field.";
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `Error: Invalid YAML in frontmatter: ${errorMessage}`;
    }

    return undefined;
  }

  /**
   * Validate that a file path is safe (no path traversal).
   * @returns Error message if invalid, undefined if valid
   */
  private validateFilePath(path: string): string | undefined {
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
      return `Error: Invalid path '${path}' - path traversal is not allowed.`;
    }

    // Check for absolute Windows paths
    if (/^[a-zA-Z]:/.test(path)) {
      return `Error: Invalid path '${path}' - absolute paths are not allowed.`;
    }

    return undefined;
  }

  /**
   * Get skill metadata either from provided content or by re-discovering.
   */
  private async getSkillMetadata(
    skillName: string,
    skillDir: string,
    content?: string,
  ): Promise<SkillMetadata> {
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
    const skills = await this.skillService.discoverSkills();
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
}
