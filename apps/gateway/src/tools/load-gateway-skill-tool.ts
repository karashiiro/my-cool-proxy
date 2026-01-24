import { injectable } from "inversify";
import * as z from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ITool } from "./base-tool.js";
import type { ILogger, ISkillDiscoveryService } from "../types/interfaces.js";

/**
 * Tool that loads content from a gateway skill.
 *
 * Gateway skills are stored locally in the skills directory and provide
 * extended instructions for specific tasks. This tool can retrieve:
 * - The main SKILL.md content (default)
 * - Resource files from scripts/, references/, or assets/ directories
 */
@injectable()
export class LoadGatewaySkillTool implements ITool {
  readonly name = "load-gateway-skill";
  readonly description =
    "Load the full content of a gateway skill by name. Use this to get complete " +
    "instructions for a skill listed in the available gateway skills. Gateway skills " +
    "provide specialized guidance for specific tasks. Optionally specify a path to " +
    "load a specific resource file (e.g., scripts/extract.py, references/REFERENCE.md).";

  readonly schema = {
    skillName: z.string().describe("The name of the skill to load"),
    path: z
      .string()
      .optional()
      .describe(
        "Optional relative path to a resource within the skill (e.g., 'scripts/extract.py'). " +
          "If omitted, loads the main SKILL.md content.",
      ),
  };

  constructor(
    @$inject(TYPES.SkillDiscoveryService)
    private skillService: ISkillDiscoveryService,
    @$inject(TYPES.Logger) private logger: ILogger,
  ) {}

  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const { skillName, path } = args as { skillName: string; path?: string };

    // If path is provided, load a specific resource
    if (path) {
      return this.loadResource(skillName, path);
    }

    // Otherwise, load the main SKILL.md content
    return this.loadSkillContent(skillName);
  }

  private async loadSkillContent(skillName: string): Promise<CallToolResult> {
    this.logger.debug(`Loading gateway skill: ${skillName}`);

    const content = await this.skillService.getSkillContent(skillName);

    if (!content) {
      this.logger.warn(`Gateway skill not found: ${skillName}`);
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

    this.logger.info(`Loaded gateway skill: ${skillName}`);
    return {
      content: [{ type: "text", text: content }],
    };
  }

  private async loadResource(
    skillName: string,
    path: string,
  ): Promise<CallToolResult> {
    this.logger.debug(`Loading skill resource: ${skillName}/${path}`);

    try {
      const content = await this.skillService.getSkillResource(skillName, path);

      if (content === null) {
        this.logger.warn(`Skill resource not found: ${skillName}/${path}`);
        return {
          content: [
            {
              type: "text",
              text:
                `Resource '${path}' not found in skill '${skillName}'. ` +
                `Check that the file exists in the skill's scripts/, references/, or assets/ directory.`,
            },
          ],
          isError: true,
        };
      }

      this.logger.info(`Loaded skill resource: ${skillName}/${path}`);
      return {
        content: [{ type: "text", text: content }],
      };
    } catch (error) {
      // Path traversal or other security error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to load skill resource: ${errorMessage}`);
      return {
        content: [
          {
            type: "text",
            text: errorMessage,
          },
        ],
        isError: true,
      };
    }
  }
}
