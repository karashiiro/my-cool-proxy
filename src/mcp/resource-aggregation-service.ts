import { injectable, inject } from "inversify";
import type {
  ListResourcesResult,
  ReadResourceResult,
  Resource,
} from "@modelcontextprotocol/sdk/types.js";
import type { IMCPClientManager, ILogger } from "../types/interfaces.js";
import { TYPES } from "../types/index.js";
import { namespaceResource, parseResourceUri } from "../utils/resource-uri.js";
import type { MCPClientSession } from "./client-session.js";

@injectable()
export class ResourceAggregationService {
  private cache = new Map<
    string,
    { resources: Resource[]; timestamp: number }
  >();

  constructor(
    @inject(TYPES.MCPClientManager) private clientPool: IMCPClientManager,
    @inject(TYPES.Logger) private logger: ILogger,
  ) {}

  async listResources(sessionId: string): Promise<ListResourcesResult> {
    const session = sessionId || "default";

    const cached = this.cache.get(session);
    if (cached) {
      this.logger.debug(
        `Returning cached resource list for session '${session}'`,
      );
      return { resources: cached.resources };
    }

    const clients = this.clientPool.getClientsBySession(session);

    if (clients.size === 0) {
      this.logger.info(`No clients available for session '${session}'`);
      return { resources: [] };
    }

    const resourcePromises = Array.from(clients.entries()).map(
      async ([name, client]) => {
        try {
          const result = await client.listResources();
          return { name, resources: result.resources };
        } catch (error) {
          this.logger.error(
            `Failed to list resources from server '${name}':`,
            error as Error,
          );
          return { name, resources: [] };
        }
      },
    );

    const results = await Promise.all(resourcePromises);

    const allResources: Resource[] = [];
    for (const { name, resources } of results) {
      for (const resource of resources) {
        allResources.push(namespaceResource(name, resource));
      }
    }

    this.cache.set(session, { resources: allResources, timestamp: Date.now() });

    this.logger.info(
      `Aggregated ${allResources.length} resources from ${clients.size} servers for session '${session}'`,
    );

    return { resources: allResources };
  }

  async readResource(
    uri: string,
    sessionId: string,
  ): Promise<ReadResourceResult> {
    const session = sessionId || "default";

    const parsed = parseResourceUri(uri);
    if (!parsed) {
      throw new Error(
        `Invalid resource URI format: '${uri}'. Expected format: mcp://{server-name}/{uri}`,
      );
    }

    const { serverName, originalUri } = parsed;

    const clients = this.clientPool.getClientsBySession(session);
    const client = clients.get(serverName) as MCPClientSession | undefined;

    if (!client) {
      const availableServers = Array.from(clients.keys()).join(", ");
      throw new Error(
        `Server '${serverName}' not found in session '${session}'. Available servers: ${availableServers || "none"}`,
      );
    }

    try {
      const result = await client.readResource({ uri: originalUri });
      this.logger.debug(
        `Read resource '${originalUri}' from server '${serverName}'`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to read resource '${originalUri}' from server '${serverName}':`,
        error as Error,
      );
      throw error;
    }
  }

  handleResourceListChanged(serverName: string, sessionId: string): void {
    this.logger.info(
      `Resource list changed for server '${serverName}' in session '${sessionId}'`,
    );
    this.cache.delete(sessionId);
  }
}

export default ResourceAggregationService;
