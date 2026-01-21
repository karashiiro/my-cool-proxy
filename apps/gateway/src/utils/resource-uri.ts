import type {
  Resource,
  CallToolResult,
  GetPromptResult,
} from "@modelcontextprotocol/sdk/types.js";

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

/**
 * Namespace resource URIs in a CallToolResult's content blocks.
 * This walks through all content blocks and namespaces any resource URIs
 * in both resource_link blocks and embedded resource blocks.
 *
 * @param serverName - The name of the MCP server that returned this result
 * @param result - The CallToolResult to process
 * @returns A new CallToolResult with namespaced resource URIs
 *
 * @example
 * // Resource link block
 * const result1 = {
 *   content: [
 *     { type: "text", text: "Here's the resource:" },
 *     { type: "resource_link", uri: "file:///data.json" }
 *   ]
 * };
 * namespaceCallToolResultResources("data-server", result1)
 * // Returns: { ..., content: [text, { type: "resource_link", uri: "mcp://data-server/file:///data.json" }]}
 *
 * @example
 * // Embedded resource block
 * const result2 = {
 *   content: [
 *     { type: "resource", resource: { uri: "file:///data.json", text: "..." } }
 *   ]
 * };
 * namespaceCallToolResultResources("data-server", result2)
 * // Returns: { ..., content: [{ type: "resource", resource: { uri: "mcp://data-server/file:///data.json", text: "..." }}]}
 */
export function namespaceCallToolResultResources(
  serverName: string,
  result: CallToolResult,
): CallToolResult {
  // Clone the result to avoid mutation
  const namespacedContent = result.content.map((block) => {
    if (typeof block !== "object" || block === null || !("type" in block)) {
      return block;
    }

    // Handle resource_link content blocks (flat structure)
    if (block.type === "resource_link" && "uri" in block) {
      return {
        ...block,
        uri: namespaceResourceUri(serverName, block.uri as string),
      };
    }

    // Handle embedded resource content blocks (nested structure)
    if (
      block.type === "resource" &&
      "resource" in block &&
      typeof block.resource === "object" &&
      block.resource !== null &&
      "uri" in block.resource
    ) {
      return {
        ...block,
        resource: {
          ...block.resource,
          uri: namespaceResourceUri(serverName, block.resource.uri as string),
        },
      };
    }

    // Return other content blocks unchanged
    return block;
  });

  return {
    ...result,
    content: namespacedContent,
  };
}

/**
 * Namespace resource URIs in a GetPromptResult's message content blocks.
 * This walks through all messages and their content blocks, namespacing any resource URIs.
 *
 * @param serverName - The name of the MCP server that returned this result
 * @param result - The GetPromptResult to process
 * @returns A new GetPromptResult with namespaced resource URIs
 *
 * @example
 * const promptResult = {
 *   messages: [
 *     {
 *       role: "user",
 *       content: {
 *         type: "resource_link",
 *         name: "Doc",
 *         uri: "file:///docs/README.md"
 *       }
 *     }
 *   ]
 * };
 * namespaceGetPromptResultResources("docs-server", promptResult)
 * // Returns result with URI: "mcp://docs-server/file:///docs/README.md"
 */
export function namespaceGetPromptResultResources(
  serverName: string,
  result: GetPromptResult,
): GetPromptResult {
  // Clone the result and namespace content in each message
  const namespacedMessages = result.messages.map((message) => {
    const content = message.content;

    // Skip if content is not an object
    if (
      typeof content !== "object" ||
      content === null ||
      !("type" in content)
    ) {
      return message;
    }

    // Handle resource_link content blocks (flat structure)
    if (content.type === "resource_link" && "uri" in content) {
      return {
        ...message,
        content: {
          ...content,
          uri: namespaceResourceUri(serverName, content.uri as string),
        },
      };
    }

    // Handle embedded resource content blocks (nested structure)
    if (
      content.type === "resource" &&
      "resource" in content &&
      typeof content.resource === "object" &&
      content.resource !== null &&
      "uri" in content.resource
    ) {
      return {
        ...message,
        content: {
          ...content,
          resource: {
            ...content.resource,
            uri: namespaceResourceUri(
              serverName,
              content.resource.uri as string,
            ),
          },
        },
      };
    }

    // Return message unchanged if no resource URIs found
    return message;
  });

  return {
    ...result,
    messages: namespacedMessages,
  };
}
