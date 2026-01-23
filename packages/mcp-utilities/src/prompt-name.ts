import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

/**
 * Namespace a prompt name with a server name prefix.
 *
 * @param serverName - The name of the MCP server
 * @param name - The original prompt name
 * @returns The namespaced name in format: {serverName}/{originalName}
 *
 * @example
 * namespacePromptName("docs-server", "code-review")
 * // Returns: "docs-server/code-review"
 */
export function namespacePromptName(serverName: string, name: string): string {
  return `${serverName}/${name}`;
}

/**
 * Parse a namespaced prompt name back to its components.
 *
 * @param namespacedName - The namespaced name to parse
 * @returns Object with serverName and originalName, or null if format is invalid
 *
 * @example
 * parsePromptName("docs-server/code-review")
 * // Returns: { serverName: "docs-server", originalName: "code-review" }
 */
export function parsePromptName(
  namespacedName: string,
): { serverName: string; originalName: string } | null {
  // Expected format: {serverName}/{originalName}
  const firstSlashIndex = namespacedName.indexOf("/");

  if (firstSlashIndex === -1) {
    // No slash found, invalid format
    return null;
  }

  const serverName = namespacedName.slice(0, firstSlashIndex);
  const originalName = namespacedName.slice(firstSlashIndex + 1);

  if (!serverName || !originalName) {
    return null;
  }

  return {
    serverName,
    originalName,
  };
}

/**
 * Transform a prompt object to namespace its name with a server name.
 *
 * @param serverName - The name of the MCP server
 * @param prompt - The original prompt object
 * @returns A new prompt object with the namespaced name
 *
 * @example
 * const prompt = { name: "code-review", description: "Review code" };
 * namespacePrompt("docs-server", prompt)
 * // Returns: { name: "docs-server/code-review", description: "Review code" }
 */
export function namespacePrompt(serverName: string, prompt: Prompt): Prompt {
  return {
    ...prompt,
    name: namespacePromptName(serverName, prompt.name),
  };
}
