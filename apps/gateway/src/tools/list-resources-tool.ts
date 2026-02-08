import { injectable } from "inversify";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ITool, ToolExecutionContext } from "./base-tool.js";
import { ResourceAggregationService } from "@my-cool-proxy/mcp-aggregation";
import { parseResourceUri } from "@my-cool-proxy/mcp-utilities";

/**
 * Tool that lists all available MCP resources across all connected servers.
 *
 * Returns a formatted listing of resources grouped by server, with their
 * namespaced URIs that can be passed directly to the read-resource tool.
 */
@injectable()
export class ListResourcesTool implements ITool {
  readonly name = "list-resources";
  readonly description =
    "Lists gateway-proxied resources from upstream MCP servers. Returns only resources that are accessible " +
    "through this gateway instance. Each resource includes a namespaced URI (gw:// or gw-skill:// scheme) " +
    "that can be passed to read-resource.\n\n" +
    "Parameters:\n" +
    "- server (optional): The name of a specific MCP server to get resources from. If not provided, " +
    "resources from all connected servers will be returned.";
  readonly schema = {};

  constructor(
    @$inject(TYPES.ResourceAggregationService)
    private resourceAggregation: ResourceAggregationService,
  ) {}

  async execute(
    _args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    const sessionId = context.sessionId || "default";

    const result = await this.resourceAggregation.listResources(sessionId);
    const resources = result.resources;

    if (resources.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No resources are currently available from any connected MCP server.",
          },
        ],
      };
    }

    // Group resources by server name (extracted from the namespaced URI)
    const byServer = new Map<string, typeof resources>();
    for (const resource of resources) {
      const parsed = parseResourceUri(resource.uri);
      const serverName = parsed?.serverName ?? "unknown";
      const group = byServer.get(serverName);
      if (group) {
        group.push(resource);
      } else {
        byServer.set(serverName, [resource]);
      }
    }

    const lines: string[] = [];
    lines.push(
      `Available Resources (${resources.length} total across ${byServer.size} server${byServer.size === 1 ? "" : "s"})`,
    );
    lines.push("=".repeat(lines[0]!.length));

    for (const [serverName, serverResources] of byServer) {
      lines.push("");
      lines.push(
        `## ${serverName} (${serverResources.length} resource${serverResources.length === 1 ? "" : "s"})`,
      );
      lines.push("");

      for (const resource of serverResources) {
        lines.push(`- **${resource.name}**`);
        lines.push(`  URI: ${resource.uri}`);
        if (resource.description) {
          lines.push(`  Description: ${resource.description}`);
        }
        if (resource.mimeType) {
          lines.push(`  MIME type: ${resource.mimeType}`);
        }
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
}
