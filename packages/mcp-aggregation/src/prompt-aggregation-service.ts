import type {
  ListPromptsResult,
  GetPromptResult,
  Prompt,
} from "@modelcontextprotocol/sdk/types.js";
import { namespacePrompt, parsePromptName } from "@my-cool-proxy/mcp-utilities";
import { createCache } from "@my-cool-proxy/mcp-client";
import type { IMCPClientManager, ILogger, ICacheService } from "./types.js";
import type { IResourceRoutingService } from "./resource-routing-service.js";
import { lookupServerOrThrow } from "./utils/server-lookup.js";

export class PromptAggregationService {
  private cache: ICacheService<Prompt[]>;

  constructor(
    private clientPool: IMCPClientManager,
    private logger: ILogger,
    private routingService: IResourceRoutingService,
  ) {
    // Create a cache instance for this service
    this.cache = createCache<Prompt[]>(logger);
  }

  async listPrompts(sessionId: string): Promise<ListPromptsResult> {
    const session = sessionId || "default";

    const cached = this.cache.get(session);
    if (cached) {
      this.logger.debug(
        `Returning cached prompt list for session '${session}'`,
      );
      return { prompts: cached };
    }

    const clients = this.clientPool.getClientsBySession(session);

    if (clients.size === 0) {
      this.logger.info(`No clients available for session '${session}'`);
      return { prompts: [] };
    }

    const promptPromises = Array.from(clients.entries()).map(
      async ([name, client]) => {
        try {
          const result = await client.listPrompts();
          return { name, prompts: result };
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("Server does not support prompts")
          ) {
            // Ignore noisy error - we already avoid sending the underlying request via enforceStrictCapabilities
            return { name, prompts: [] };
          }

          this.logger.error(
            `Failed to list prompts from server '${name}':`,
            error as Error,
          );
          return { name, prompts: [] };
        }
      },
    );

    const results = await Promise.all(promptPromises);

    const allPrompts: Prompt[] = [];
    for (const { name, prompts } of results) {
      for (const prompt of prompts) {
        allPrompts.push(namespacePrompt(name, prompt));
      }
    }

    this.cache.set(session, allPrompts);

    this.logger.info(
      `Aggregated ${allPrompts.length} prompts from ${clients.size} servers for session '${session}'`,
    );

    return { prompts: allPrompts };
  }

  async getPrompt(
    name: string,
    args: Record<string, string> | undefined,
    sessionId: string,
  ): Promise<GetPromptResult> {
    const session = sessionId || "default";
    const parsed = parsePromptName(name);
    if (!parsed) {
      throw new Error(
        `Invalid prompt name format: '${name}'. Expected format: {server-name}/{prompt-name}`,
      );
    }

    const { serverName, originalName } = parsed;
    const { client } = lookupServerOrThrow({
      serverName,
      sessionId: session,
      clientPool: this.clientPool,
    });

    try {
      const result = await client.getPrompt({
        name: originalName,
        arguments: args,
      });
      this.logger.debug(
        `Got prompt '${originalName}' from server '${serverName}'`,
      );

      // Register any resource URIs found in prompt message content
      // so they can be routed correctly via readResource later
      this.registerPromptResultResources(session, serverName, result);

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get prompt '${originalName}' from server '${serverName}':`,
        error as Error,
      );
      throw error;
    }
  }

  handlePromptListChanged(serverName: string, sessionId: string): void {
    this.logger.info(
      `Prompt list changed for server '${serverName}' in session '${sessionId}'`,
    );
    this.cache.delete(sessionId);
  }

  /**
   * Walk through a GetPromptResult and register any resource URIs
   * found in message content blocks for future routing.
   */
  private registerPromptResultResources(
    sessionId: string,
    serverName: string,
    result: GetPromptResult,
  ): void {
    for (const message of result.messages) {
      const content = message.content;
      if (
        typeof content !== "object" ||
        content === null ||
        !("type" in content)
      ) {
        continue;
      }

      // resource_link content blocks (flat structure)
      if (content.type === "resource_link" && "uri" in content) {
        this.routingService.registerEncounteredUri(
          sessionId,
          content.uri as string,
          serverName,
        );
      }

      // embedded resource content blocks (nested structure)
      if (
        content.type === "resource" &&
        "resource" in content &&
        typeof content.resource === "object" &&
        content.resource !== null &&
        "uri" in content.resource
      ) {
        this.routingService.registerEncounteredUri(
          sessionId,
          content.resource.uri as string,
          serverName,
        );
      }
    }
  }
}

export default PromptAggregationService;
