import { injectable } from "inversify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  ILogger,
  IServerInfoPreloader,
  PreloadedServerInfo,
  ServerConfig,
  SkillMetadata,
} from "../types/interfaces.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";

const MAX_INSTRUCTION_EXCERPT_LENGTH = 200;

@injectable()
export class ServerInfoPreloader implements IServerInfoPreloader {
  constructor(@$inject(TYPES.Logger) private logger: ILogger) {}

  async preloadServerInfo(
    config: ServerConfig,
  ): Promise<PreloadedServerInfo[]> {
    const results: PreloadedServerInfo[] = [];

    const probePromises = Object.entries(config.mcpClients).map(
      async ([name, clientConfig]): Promise<PreloadedServerInfo> => {
        try {
          // Create a minimal client just for probing
          const sdkClient = new Client(
            {
              name: "my-cool-proxy-probe",
              version: "1.0.0",
            },
            {
              capabilities: {},
              enforceStrictCapabilities: true,
            },
          );

          let transport;
          if (clientConfig.type === "http") {
            transport = new StreamableHTTPClientTransport(
              new URL(clientConfig.url),
              clientConfig.headers
                ? { requestInit: { headers: clientConfig.headers } }
                : undefined,
            );
          } else {
            transport = new StdioClientTransport({
              command: clientConfig.command,
              args: clientConfig.args,
              env: clientConfig.env,
            });
          }

          await sdkClient.connect(transport);

          // Get server info
          const serverVersion = sdkClient.getServerVersion();
          const instructions = sdkClient.getInstructions();

          // Close the probe connection
          await sdkClient.close();

          this.logger.info(
            `Preloaded info for server '${name}': ${serverVersion?.name || "unnamed"} v${serverVersion?.version || "unknown"}`,
          );

          return {
            name,
            serverName: serverVersion?.name,
            description: serverVersion?.description,
            version: serverVersion?.version,
            instructions,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to preload info for server '${name}': ${errorMessage}`,
          );
          // Return minimal info on failure
          return {
            name,
          };
        }
      },
    );

    const settledResults = await Promise.allSettled(probePromises);

    for (const result of settledResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }

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
      "Use the `list-servers` tool to see detailed information about connected servers.",
    );
    lines.push(
      "Use the `list-server-tools` tool to discover available tools for each server.",
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
## Available Gateway Skills

The following skills can be loaded using the \`load-gateway-skill\` tool:

<available_skills>
${skillsXml}
</available_skills>

Use the \`load-gateway-skill\` tool with the skill name to get full instructions.
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
