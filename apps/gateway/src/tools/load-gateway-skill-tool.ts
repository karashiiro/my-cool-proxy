import { injectable } from "inversify";
import * as z from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ITool } from "./base-tool.js";
import type { ILogger, ISkillDiscoveryService } from "../types/interfaces.js";

/**
 * Tool that loads the full content of a gateway skill by name.
 *
 * Gateway skills are stored locally in the skills directory and provide
 * extended instructions for specific tasks. This tool retrieves the full
 * SKILL.md content for a skill listed in the available gateway skills.
 */
@injectable()
export class LoadGatewaySkillTool implements ITool {
  readonly name = "load-gateway-skill";
  readonly description =
    "Load the full content of a gateway skill by name. Use this to get complete " +
    "instructions for a skill listed in the available gateway skills. Gateway skills " +
    "provide specialized guidance for specific tasks.";

  readonly schema = {
    skillName: z.string().describe("The name of the skill to load"),
  };

  constructor(
    @$inject(TYPES.SkillDiscoveryService)
    private skillService: ISkillDiscoveryService,
    @$inject(TYPES.Logger) private logger: ILogger,
  ) {}

  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const { skillName } = args as { skillName: string };

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
}
