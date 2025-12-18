import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ILogger } from "../types/interfaces.js";

export class MCPClientSession {
  private client: Client;
  private allowedTools: string[] | undefined;
  private logger: ILogger;
  private serverName: string;

  constructor(
    client: Client,
    serverName: string,
    allowedTools: string[] | undefined,
    logger: ILogger,
  ) {
    this.client = client;
    this.serverName = serverName;
    this.allowedTools = allowedTools;
    this.logger = logger;
  }

  // Wrap listTools to filter results
  async listTools() {
    const response = await this.client.listTools();
    const allTools = response.tools;

    // If no filter, return all tools
    if (this.allowedTools === undefined) {
      return response;
    }

    // If empty array, return no tools
    if (this.allowedTools.length === 0) {
      this.logger.info(
        `Server '${this.serverName}': All tools blocked by empty allowedTools array`,
      );
      return { ...response, tools: [] };
    }

    // Filter to only allowed tools
    const allowedSet = new Set(this.allowedTools);
    const filteredTools = allTools.filter((tool) => allowedSet.has(tool.name));

    // Log warnings for tools in allowedTools that don't exist
    const actualToolNames = new Set(allTools.map((t) => t.name));
    for (const allowedTool of this.allowedTools) {
      if (!actualToolNames.has(allowedTool)) {
        this.logger.error(
          `Server '${this.serverName}': Tool '${allowedTool}' in allowedTools not found. Available: ${Array.from(actualToolNames).join(", ")}`,
        );
      }
    }

    this.logger.info(
      `Server '${this.serverName}': Filtered to ${filteredTools.length} of ${allTools.length} tools: ${filteredTools.map((t) => t.name).join(", ")}`,
    );

    return { ...response, tools: filteredTools };
  }

  // Pass through other methods we need
  get experimental() {
    return this.client.experimental;
  }

  async close() {
    return this.client.close();
  }
}
