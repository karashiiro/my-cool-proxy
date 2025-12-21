import { injectable, inject } from "inversify";
import type {
  ListPromptsResult,
  GetPromptResult,
  Prompt,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  IMCPClientManager,
  ILogger,
  ICacheService,
} from "../types/interfaces.js";
import { TYPES } from "../types/index.js";
import { namespacePrompt, parsePromptName } from "../utils/prompt-name.js";
import { namespaceGetPromptResultResources } from "../utils/resource-uri.js";
import type { MCPClientSession } from "./client-session.js";
import { createCache } from "../services/cache-service.js";

@injectable()
export class PromptAggregationService {
  private cache: ICacheService<Prompt[]>;

  constructor(
    @inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @inject(TYPES.Logger) private logger: ILogger,
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
    const clients = this.clientPool.getClientsBySession(session);
    const client = clients.get(serverName) as MCPClientSession | undefined;

    if (!client) {
      const availableServers = Array.from(clients.keys()).join(", ");
      throw new Error(
        `Server '${serverName}' not found in session '${session}'. Available servers: ${availableServers || "none"}`,
      );
    }

    try {
      const result = await client.getPrompt({
        name: originalName,
        arguments: args,
      });
      this.logger.debug(
        `Got prompt '${originalName}' from server '${serverName}'`,
      );
      return namespaceGetPromptResultResources(serverName, result);
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
}

export default PromptAggregationService;
