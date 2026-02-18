import type {
  CompleteRequest,
  CompleteResult,
} from "@modelcontextprotocol/sdk/types.js";
import { parsePromptName } from "@my-cool-proxy/mcp-utilities";
import type { IMCPClientManager, ILogger } from "./types.js";
import type { IResourceRoutingService } from "./resource-routing-service.js";
import { lookupServerOrThrow } from "./utils/server-lookup.js";

export class CompletionAggregationService {
  constructor(
    private clientPool: IMCPClientManager,
    private logger: ILogger,
    private routingService: IResourceRoutingService,
  ) {}

  async complete(
    params: CompleteRequest["params"],
    sessionId: string,
  ): Promise<CompleteResult> {
    const session = sessionId || "default";

    const { serverName, routedParams } = this.parseAndRoute(params, session);

    const { client } = lookupServerOrThrow({
      serverName,
      sessionId: session,
      clientPool: this.clientPool,
    });

    try {
      const result = await client.complete(routedParams);
      this.logger.debug(
        `Completion for ${params.ref.type} from server '${serverName}': ${result.completion.values.length} value(s)`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to complete from server '${serverName}':`,
        error as Error,
      );
      throw error;
    }
  }

  private parseAndRoute(
    params: CompleteRequest["params"],
    sessionId: string,
  ): {
    serverName: string;
    routedParams: CompleteRequest["params"];
  } {
    if (params.ref.type === "ref/prompt") {
      const parsed = parsePromptName(params.ref.name);
      if (!parsed) {
        throw new Error(
          `Invalid prompt name format: '${params.ref.name}'. Expected format: {server-name}/{prompt-name}`,
        );
      }

      return {
        serverName: parsed.serverName,
        routedParams: {
          ...params,
          ref: {
            type: "ref/prompt" as const,
            name: parsed.originalName,
          },
        },
      };
    }

    if (params.ref.type === "ref/resource") {
      const serverName = this.routingService.getServerForUri(
        sessionId,
        params.ref.uri,
      );
      if (!serverName) {
        throw new Error(
          `No route found for resource URI: '${params.ref.uri}'. The resource template may not have been listed yet.`,
        );
      }

      // URI is already the original — pass through unchanged
      return {
        serverName,
        routedParams: params,
      };
    }

    throw new Error(
      `Unknown completion ref type: ${(params.ref as { type: string }).type}`,
    );
  }
}

export default CompletionAggregationService;
