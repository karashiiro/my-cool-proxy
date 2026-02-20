import { injectable } from "inversify";
import { getErrorMessage } from "@my-cool-proxy/mcp-utilities";
import type {
  ILogger,
  IMCPClientManager,
  IServerInfoPreloader,
  PreloadedServerInfo,
  ServerConfig,
  SkillMetadata,
} from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";

const PROBE_SESSION_ID = "__probe__";
const MAX_INSTRUCTION_EXCERPT_LENGTH = 200;
const MAX_TOOLS_IN_INSTRUCTIONS = 40;
const MAX_RESOURCES_IN_INSTRUCTIONS = 10;
const MAX_RESOURCE_TEMPLATES_IN_INSTRUCTIONS = 10;

@injectable()
export class ServerInfoPreloader implements IServerInfoPreloader {
  constructor(
    @$inject(TYPES.Logger) private logger: ILogger,
    @$inject(TYPES.MCPClientManager)
    private clientManager: IMCPClientManager,
  ) {}

  async preloadServerInfo(
    config: ServerConfig,
  ): Promise<PreloadedServerInfo[]> {
    // Connect all servers via the client manager using a probe session
    const connectionPromises = Object.entries(config.mcpClients).map(
      ([name, clientConfig]) => {
        if (clientConfig.type === "http") {
          return this.clientManager.addHttpClient(
            name,
            clientConfig.url,
            PROBE_SESSION_ID,
            clientConfig.headers,
          );
        } else {
          return this.clientManager.addStdioClient(
            name,
            clientConfig.command,
            PROBE_SESSION_ID,
            clientConfig.args,
            clientConfig.env,
          );
        }
      },
    );

    await Promise.allSettled(connectionPromises);

    // Gather info from successfully connected sessions
    const results: PreloadedServerInfo[] = [];
    const sessions = this.clientManager.getClientsBySession(PROBE_SESSION_ID);

    for (const [name, session] of sessions) {
      try {
        const serverVersion = session.getServerVersion();
        const instructions = session.getInstructions();

        // Get tool names
        let toolNames: string[] = [];
        try {
          const tools = await session.listTools();
          toolNames = tools.map((t) => t.name);
        } catch (error) {
          this.logger.warn(
            `Failed to list tools for server '${name}': ${getErrorMessage(error)}`,
          );
        }

        // Get resource and template names (servers without resource capability will throw)
        let resourceNames: string[] = [];
        let resourceTemplateNames: string[] = [];

        try {
          const resources = await session.listResources();
          resourceNames = resources.map((r) => r.uri);
        } catch {
          // Server doesn't support resources — that's fine
        }

        try {
          const templates = await session.listResourceTemplates();
          resourceTemplateNames = templates.map((t) => t.uriTemplate);
        } catch {
          // Server doesn't support resource templates — that's fine
        }

        this.logger.info(
          `Preloaded info for server '${name}': ${serverVersion?.name || "unnamed"} ${serverVersion?.version || "unknown"} (${toolNames.length} tools, ${resourceNames.length} resources, ${resourceTemplateNames.length} templates)`,
        );

        results.push({
          name,
          serverName: serverVersion?.name,
          description: serverVersion?.description,
          version: serverVersion?.version,
          instructions,
          toolNames,
          resourceNames,
          resourceTemplateNames,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to preload info for server '${name}': ${getErrorMessage(error)}`,
        );
        results.push({ name });
      }
    }

    // Include failed servers as minimal entries
    const failedServers = this.clientManager.getFailedServers(PROBE_SESSION_ID);
    for (const [name] of failedServers) {
      results.push({ name });
    }

    // Clean up probe connections
    await this.clientManager.closeSession(PROBE_SESSION_ID);

    return results;
  }

  buildAggregatedInstructions(servers: PreloadedServerInfo[]): string {
    if (servers.length === 0) {
      return "This is an MCP gateway proxy. No upstream servers are currently configured.";
    }

    const lines: string[] = [
      "This is an MCP gateway proxy that aggregates multiple MCP servers.",
      "",
      "Available upstream servers:",
    ];

    for (const server of servers) {
      lines.push("");
      lines.push(`## ${server.name}`);

      if (server.serverName && server.serverName !== server.name) {
        lines.push(`Server name: ${server.serverName}`);
      }

      if (server.description) {
        lines.push(`Description: ${server.description}`);
      }

      if (server.toolNames && server.toolNames.length > 0) {
        const toolsLine = this.formatToolNames(
          server.toolNames,
          MAX_TOOLS_IN_INSTRUCTIONS,
        );
        lines.push(`Tools: ${toolsLine}`);
      }

      if (server.resourceNames && server.resourceNames.length > 0) {
        const resourcesLine = this.formatToolNames(
          server.resourceNames,
          MAX_RESOURCES_IN_INSTRUCTIONS,
        );
        lines.push(`Resources: ${resourcesLine}`);
      }

      if (
        server.resourceTemplateNames &&
        server.resourceTemplateNames.length > 0
      ) {
        const templatesLine = this.formatToolNames(
          server.resourceTemplateNames,
          MAX_RESOURCE_TEMPLATES_IN_INSTRUCTIONS,
        );
        lines.push(`Resource templates: ${templatesLine}`);
      }

      if (server.instructions) {
        const excerpt = this.truncateInstructions(
          server.instructions,
          MAX_INSTRUCTION_EXCERPT_LENGTH,
        );
        lines.push(`Instructions: ${excerpt}`);
      }
    }

    lines.push("");
    lines.push(
      "You MUST use the `list-servers` tool to see detailed information about connected servers.",
    );
    lines.push(
      "You MUST use the `list-server-tools` tool to discover available tools for each server.",
    );

    return lines.join("\n");
  }

  /**
   * Build skill instructions section from discovered skills.
   * Returns a formatted string with skill metadata in XML format.
   * Returns empty string if no skills are available.
   */
  buildSkillInstructions(skills: SkillMetadata[]): string {
    if (skills.length === 0) {
      return "";
    }

    const skillsXml = skills
      .map(
        (skill) =>
          `  <skill>
    <name>${this.escapeXml(skill.name)}</name>
    <description>${this.escapeXml(skill.description)}</description>
  </skill>`,
      )
      .join("\n");

    return `
# Available Gateway Skills

The following skills are available as MCP resources with the \`gw-skill://\` URI scheme:

<available_skills>
${skillsXml}
</available_skills>

Use \`gw-skill://{skill-name}\` to load skill instructions.
Use \`gw-skill://{skill-name}/{path}\` to load nested resources (scripts/, references/, assets/).

Load these as MCP resources, not with dedicated skill tools. Within Lua scripts, use the \`_gateway\` builtins:
- \`_gateway.read_resource({ uri = "gw-skill://{skill-name}" }):await()\` to load skill content
- \`_gateway.list_resources():await()\` to discover all available resources including skills

<CRITICAL>
STRONGLY consider if there are relevant skills that may assist you in the current task.
</CRITICAL>
`;
  }

  private truncateInstructions(
    instructions: string,
    maxLength: number,
  ): string {
    // Normalize whitespace
    const normalized = instructions.replace(/\s+/g, " ").trim();

    if (normalized.length <= maxLength) {
      return normalized;
    }

    // Find a good break point (word boundary)
    const truncated = normalized.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(" ");

    if (lastSpace > maxLength * 0.7) {
      return truncated.substring(0, lastSpace) + "...";
    }

    return truncated + "...";
  }

  /**
   * Format tool names for display in instructions.
   * Limits to maxTools and adds "(and X more)" suffix if needed.
   */
  private formatToolNames(toolNames: string[], maxTools: number): string {
    if (toolNames.length <= maxTools) {
      return toolNames.join(", ");
    }

    const displayed = toolNames.slice(0, maxTools);
    const remaining = toolNames.length - maxTools;
    return `${displayed.join(", ")} (and ${remaining} more)`;
  }

  /**
   * Escape special XML characters to prevent injection.
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
