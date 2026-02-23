import { injectable } from "inversify";
import type {
  Resource,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { IResourceProvider } from "@my-cool-proxy/mcp-aggregation";
import {
  createSkillResourceUri,
  parseSkillResourceUri,
  isSkillResourceUri,
} from "@my-cool-proxy/mcp-utilities";
import type { ISkillDiscoveryService, ILogger } from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";

/**
 * Resource provider that exposes gateway skills as MCP resources.
 * Skills are accessible via the gw-skill:// URI scheme:
 * - gw-skill://{skill-name} - Main SKILL.md content
 * - gw-skill://{skill-name}/{path} - Nested resources (scripts/, references/, assets/)
 */
@injectable()
export class SkillResourceProvider implements IResourceProvider {
  constructor(
    @$inject(TYPES.SkillDiscoveryService)
    private skillService: ISkillDiscoveryService,
    @$inject(TYPES.Logger) private logger: ILogger,
  ) {}

  /**
   * List all skills as MCP resources.
   * Each skill appears as a single resource with its main SKILL.md content.
   */
  async listResources(): Promise<Resource[]> {
    const skills = await this.skillService.discoverSkills();

    return skills.map((skill) => ({
      uri: createSkillResourceUri(skill.name),
      name: skill.name,
      description: skill.description,
      mimeType: "text/markdown",
    }));
  }

  /**
   * Check if this provider handles the given URI.
   * Returns true for any gw-skill:// URI.
   */
  handlesUri(uri: string): boolean {
    return isSkillResourceUri(uri);
  }

  /**
   * Read a skill resource by URI.
   * Supports both main SKILL.md content and nested resource files.
   */
  async readResource(uri: string): Promise<ReadResourceResult | null> {
    const parsed = parseSkillResourceUri(uri);
    if (!parsed) {
      return null;
    }

    const { skillName, path } = parsed;

    let content: string | null;
    if (path) {
      // Read nested resource file
      content = await this.skillService.getSkillResource(skillName, path);
    } else {
      // Read main SKILL.md content
      content = await this.skillService.getSkillContent(skillName);
    }

    if (content === null) {
      this.logger.debug(`Skill resource not found: ${uri}`);
      throw new Error(`Skill resource not found: ${uri}`);
    }

    // Determine MIME type based on file extension
    const mimeType = getMimeType(path);

    return {
      contents: [
        {
          uri,
          mimeType,
          text: content,
        },
      ],
    };
  }
}

/**
 * Get MIME type based on file path extension.
 * Defaults to text/markdown for SKILL.md files (no path).
 */
function getMimeType(path?: string): string {
  if (!path) {
    return "text/markdown";
  }

  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md":
      return "text/markdown";
    case "py":
      return "text/x-python";
    case "js":
      return "application/javascript";
    case "ts":
      return "text/typescript";
    case "json":
      return "application/json";
    case "yaml":
    case "yml":
      return "text/yaml";
    case "sh":
      return "application/x-sh";
    case "txt":
      return "text/plain";
    default:
      return "text/plain";
  }
}
