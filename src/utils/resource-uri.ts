import type { Resource } from "@modelcontextprotocol/sdk/types.js";

/**
 * Namespace a resource URI with a server name prefix.
 *
 * @param serverName - The name of the MCP server
 * @param uri - The original resource URI
 * @returns The namespaced URI in format: mcp://{serverName}/{originalUri}
 *
 * @example
 * namespaceResourceUri("context7", "file:///docs/README.md")
 * // Returns: "mcp://context7/file:///docs/README.md"
 */
export function namespaceResourceUri(serverName: string, uri: string): string {
  return `mcp://${serverName}/${uri}`;
}

/**
 * Parse a namespaced resource URI back to its components.
 *
 * @param namespacedUri - The namespaced URI to parse
 * @returns Object with serverName and originalUri, or null if format is invalid
 *
 * @example
 * parseResourceUri("mcp://context7/file:///docs/README.md")
 * // Returns: { serverName: "context7", originalUri: "file:///docs/README.md" }
 */
export function parseResourceUri(
  namespacedUri: string,
): { serverName: string; originalUri: string } | null {
  // Expected format: mcp://{serverName}/{originalUri}
  const mcpPrefix = "mcp://";

  if (!namespacedUri.startsWith(mcpPrefix)) {
    return null;
  }

  // Remove the "mcp://" prefix
  const withoutPrefix = namespacedUri.slice(mcpPrefix.length);

  // Find the first "/" to split server name from original URI
  const firstSlashIndex = withoutPrefix.indexOf("/");

  if (firstSlashIndex === -1) {
    // No slash found, invalid format
    return null;
  }

  const serverName = withoutPrefix.slice(0, firstSlashIndex);
  const originalUri = withoutPrefix.slice(firstSlashIndex + 1);

  if (!serverName || !originalUri) {
    return null;
  }

  return {
    serverName,
    originalUri,
  };
}

/**
 * Transform a resource object to namespace its URI with a server name.
 *
 * @param serverName - The name of the MCP server
 * @param resource - The original resource object
 * @returns A new resource object with the namespaced URI
 *
 * @example
 * const resource = { uri: "file:///docs/README.md", name: "README" };
 * namespaceResource("context7", resource)
 * // Returns: { uri: "mcp://context7/file:///docs/README.md", name: "README" }
 */
export function namespaceResource(
  serverName: string,
  resource: Resource,
): Resource {
  return {
    ...resource,
    uri: namespaceResourceUri(serverName, resource.uri),
  };
}
