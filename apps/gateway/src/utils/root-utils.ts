import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { Root } from "@modelcontextprotocol/sdk/types.js";

/**
 * Extract a valid local filesystem path from a root URI.
 * Returns undefined if the URI is not a local file:// path or doesn't exist.
 *
 * @param rootUri - The root URI to validate and convert
 * @returns The local filesystem path, or undefined if not valid/accessible
 */
export function extractLocalPath(rootUri: string): string | undefined {
  try {
    const url = new URL(rootUri);

    // Only accept file:// URIs
    if (url.protocol !== "file:") {
      return undefined;
    }

    // Reject file:// URIs with hostnames (network paths)
    if (url.hostname && url.hostname !== "localhost" && url.hostname !== "") {
      return undefined;
    }

    const filePath = fileURLToPath(rootUri);

    // Verify the path exists and is accessible
    if (!existsSync(filePath)) {
      return undefined;
    }

    return filePath;
  } catch {
    // Invalid URI or file path conversion failed
    return undefined;
  }
}

/**
 * Find the first valid local root from a list of roots.
 * Returns undefined if no valid local roots exist.
 *
 * @param roots - The list of roots to search
 * @returns The first valid local filesystem path, or undefined
 */
export function findValidLocalRoot(roots: Root[]): string | undefined {
  for (const root of roots) {
    const localPath = extractLocalPath(root.uri);
    if (localPath) {
      return localPath;
    }
  }
  return undefined;
}
