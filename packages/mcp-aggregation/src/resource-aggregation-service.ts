import type {
  ListResourcesResult,
  ListResourceTemplatesResult,
  ReadResourceResult,
  Resource,
  ResourceTemplate as ResourceTemplateType,
} from "@modelcontextprotocol/sdk/types.js";
import { createCache } from "@my-cool-proxy/mcp-client";
import type {
  IMCPClientManager,
  ILogger,
  ICacheService,
  IResourceProvider,
} from "./types.js";
import type { IResourceRoutingService } from "./resource-routing-service.js";
import { lookupServerOrThrow } from "./utils/server-lookup.js";

export class ResourceAggregationService {
  private cache: ICacheService<Resource[]>;
  private templateCache: ICacheService<ResourceTemplateType[]>;

  constructor(
    private clientPool: IMCPClientManager,
    private logger: ILogger,
    private routingService: IResourceRoutingService,
    private additionalProviders: IResourceProvider[] = [],
  ) {
    // Create cache instances for this service
    this.cache = createCache<Resource[]>(logger);
    this.templateCache = createCache<ResourceTemplateType[]>(logger);
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
          this.routingService.registerUri(session, resource.uri, name);
          allResources.push(resource);
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

  async listResourceTemplates(
    sessionId: string,
  ): Promise<ListResourceTemplatesResult> {
    const session = sessionId || "default";

    const cached = this.templateCache.get(session);
    if (cached) {
      this.logger.debug(
        `Returning cached resource template list for session '${session}'`,
      );
      return { resourceTemplates: cached };
    }

    const allTemplates: ResourceTemplateType[] = [];

    const clients = this.clientPool.getClientsBySession(session);
    if (clients.size > 0) {
      const templatePromises = Array.from(clients.entries()).map(
        async ([name, client]) => {
          try {
            const result = await client.listResourceTemplates();
            return { name, templates: result };
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes("Server does not support")
            ) {
              return { name, templates: [] };
            }

            this.logger.error(
              `Failed to list resource templates from server '${name}':`,
              error as Error,
            );
            return { name, templates: [] };
          }
        },
      );

      const results = await Promise.all(templatePromises);

      for (const { name, templates } of results) {
        for (const template of templates) {
          this.routingService.registerTemplate(
            session,
            template.uriTemplate,
            name,
          );
          allTemplates.push(template);
        }
      }
    }

    this.templateCache.set(session, allTemplates);

    this.logger.info(
      `Aggregated ${allTemplates.length} resource templates from ${clients.size} server(s) for session '${session}'`,
    );

    return { resourceTemplates: allTemplates };
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

    // Look up the server via routing table
    let serverName = this.routingService.getServerForUri(session, uri);

    // If no route found, auto-populate by listing resources and templates
    if (!serverName) {
      this.logger.debug(
        `No route for '${uri}', auto-populating resource routes for session '${session}'`,
      );
      await Promise.all([
        this.listResources(session),
        this.listResourceTemplates(session),
      ]);
      serverName = this.routingService.getServerForUri(session, uri);
    }

    if (!serverName) {
      throw new Error(
        `No route found for resource URI: '${uri}'. No server provides this resource or matches it via a template.`,
      );
    }

    const { client } = lookupServerOrThrow({
      serverName,
      sessionId: session,
      clientPool: this.clientPool,
    });

    try {
      const result = await client.readResource({ uri });
      this.logger.debug(`Read resource '${uri}' from server '${serverName}'`);

      // Register content URIs as encountered for future routing
      for (const content of result.contents) {
        this.routingService.registerEncounteredUri(
          session,
          content.uri,
          serverName,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to read resource '${uri}' from server '${serverName}':`,
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
    this.templateCache.delete(sessionId);
    this.routingService.invalidateSession(sessionId);
  }
}

export default ResourceAggregationService;
