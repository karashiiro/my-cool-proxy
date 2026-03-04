import type { IMCPClientSession, ILogger } from "../types.js";

export interface AggregationResult<T> {
  name: string;
  result: T;
}

/**
 * Aggregate results from all connected MCP servers for a session.
 * Handles errors per-server gracefully, logging failures and continuing.
 */
export async function aggregateFromServers<T>(
  clients: Map<string, IMCPClientSession>,
  fetchFn: (name: string, client: IMCPClientSession) => Promise<T>,
  logger: ILogger,
  options?: {
    /** Error message to suppress (e.g., "Server does not support X") */
    suppressErrorContaining?: string;
  },
): Promise<AggregationResult<T>[]> {
  const promises = Array.from(clients.entries()).map(async ([name, client]) => {
    try {
      const result = await fetchFn(name, client);
      const aggregationResult: AggregationResult<T> = { name, result };
      return aggregationResult;
    } catch (error) {
      if (
        options?.suppressErrorContaining &&
        error instanceof Error &&
        error.message.includes(options.suppressErrorContaining)
      ) {
        return null;
      }
      logger.error(
        `Failed to aggregate from server '${name}':`,
        error as Error,
      );
      return null;
    }
  });

  const results = await Promise.all(promises);
  return results.filter((r): r is AggregationResult<T> => r !== null);
}
