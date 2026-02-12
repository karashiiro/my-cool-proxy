import type {
  ListResourcesResult,
  ReadResourceResult,
  Resource,
} from "@modelcontextprotocol/sdk/types.js";
import {
  namespaceResource,
  namespaceResourceUri,
  parseResourceUri,
} from "@my-cool-proxy/mcp-utilities";
import { createCache } from "@my-cool-proxy/mcp-client";
import type {
  IMCPClientManager,
  ILogger,
  ICacheService,
  IResourceProvider,
} from "./types.js";
import { lookupServerOrThrow } from "./utils/server-lookup.js";

export class ResourceAggregationService {
  private cache: ICacheService<Resource[]>;

  constructor(
    private clientPool: IMCPClientManager,
    private logger: ILogger,
    private additionalProviders: IResourceProvider[] = [],
  ) {
    // Create a cache instance for this service
    this.cache = createCache<Resource[]>(logger);
  }

  async listResources(sessionId: string): Promise<ListResourcesResult> {
    const session = sessionId || "default";

    const cached = this.cache.get(session);
    if (cached) {
      this.logger.debug(
        `Returning cached resource list for session '${session}'`,
      );
      return { resources: cached };
    }

    const allResources: Resource[] = [];

    // Collect resources from MCP servers
    const clients = this.clientPool.getClientsBySession(session);
    if (clients.size > 0) {
      const resourcePromises = Array.from(clients.entries()).map(
        async ([name, client]) => {
          try {
            const result = await client.listResources();
            return { name, resources: result };
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes("Server does not support resources")
            ) {
              // Ignore noisy error - we already avoid sending the underlying request via enforceStrictCapabilities
              return { name, resources: [] };
            }

            this.logger.error(
              `Failed to list resources from server '${name}':`,
              error as Error,
            );
            return { name, resources: [] };
          }
        },
      );

      const results = await Promise.all(resourcePromises);

      for (const { name, resources } of results) {
        for (const resource of resources) {
          allResources.push(namespaceResource(name, resource));
        }
      }
    }

    // Add resources from additional providers (e.g., gateway skills)
    for (const provider of this.additionalProviders) {
      try {
        const providerResources = await provider.listResources();
        allResources.push(...providerResources);
      } catch (error) {
        this.logger.error(
          "Failed to list resources from additional provider:",
          error as Error,
        );
      }
    }

    this.cache.set(session, allResources);

    this.logger.info(
      `Aggregated ${allResources.length} resources from ${clients.size} server(s) for session '${session}'`,
    );

    return { resources: allResources };
  }

  async readResource(
    uri: string,
    sessionId: string,
  ): Promise<ReadResourceResult> {
    const session = sessionId || "default";

    // Check additional providers first (e.g., gw-skill:// URIs)
    for (const provider of this.additionalProviders) {
      if (provider.handlesUri(uri)) {
        const result = await provider.readResource(uri);
        if (result) {
          this.logger.debug(`Read resource '${uri}' from additional provider`);
          return result;
        }
      }
    }

    // Fall back to MCP server routing for gw:// URIs
    const parsed = parseResourceUri(uri);
    if (!parsed) {
      throw new Error(
        `Invalid resource URI format: '${uri}'. Expected format: gw://{server-name}/{uri}`,
      );
    }

    const { serverName, originalUri } = parsed;

    const { client } = lookupServerOrThrow({
      serverName,
      sessionId: session,
      clientPool: this.clientPool,
    });

    try {
      const result = await client.readResource({ uri: originalUri });
      this.logger.debug(
        `Read resource '${originalUri}' from server '${serverName}'`,
      );

      // Namespace the URIs in the response contents
      const namespacedContents = result.contents.map((content) => ({
        ...content,
        uri: namespaceResourceUri(serverName, content.uri),
      }));

      return {
        ...result,
        contents: namespacedContents,
      };
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
