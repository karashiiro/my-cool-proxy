import { injectable } from "inversify";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ITool, ToolExecutionContext } from "./base-tool.js";
import type { ILogger } from "../types/interfaces.js";
import { ResourceAggregationService } from "@my-cool-proxy/mcp-aggregation";

/**
 * Tool that reads the contents of a specific MCP resource by its namespaced URI.
 *
 * Accepts URIs in the format returned by list-resources (mcp://{server}/{originalUri}),
 * routes the request to the appropriate upstream server, and returns the content.
 */
@injectable()
export class ReadResourceTool implements ITool {
  readonly name = "read-resource";
  readonly description =
    "Reads a specific resource from an MCP server, identified by server name and resource URI.\n\n" +
    "Parameters:\n" +
    "- server (required): The name of the MCP server from which to read the resource\n" +
    "- uri (required): The URI of the resource to read";
  readonly schema = {
    uri: z
      .string()
      .describe("The namespaced resource URI (as returned by list-resources)"),
  };

  constructor(
    @$inject(TYPES.ResourceAggregationService)
    private resourceAggregation: ResourceAggregationService,
    @$inject(TYPES.Logger) private logger: ILogger,
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<CallToolResult> {
    const uri = args.uri as string;
    const sessionId = context.sessionId || "default";

    if (!uri || typeof uri !== "string") {
      return {
        content: [
          {
            type: "text",
            text: "Missing required parameter: uri. Provide a namespaced resource URI (e.g., mcp://server-name/original-uri).",
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await this.resourceAggregation.readResource(
        uri,
        sessionId,
      );

      if (result.contents.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Resource at '${uri}' returned no content.`,
            },
          ],
        };
      }

      const blocks: string[] = [];

      for (const entry of result.contents) {
        const header = entry.mimeType
          ? `[${entry.uri}] (${entry.mimeType})`
          : `[${entry.uri}]`;
        blocks.push(header);

        if ("text" in entry) {
          blocks.push(entry.text as string);
        } else if ("blob" in entry) {
          blocks.push(
            `[Binary content, ${((entry.blob as string).length * 3) / 4} bytes (approx). Base64 data omitted.]`,
          );
        }
      }

      return { content: [{ type: "text", text: blocks.join("\n") }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to read resource '${uri}':`, error as Error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to read resource '${uri}': ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
}
