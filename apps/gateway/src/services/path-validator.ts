import { resolve, sep } from "path";

/**
 * Validate that a relative path component doesn't contain path traversal.
 * @param name - A name that should be a simple filename (no separators)
 * @returns true if safe, false if contains path separators
 */
export function isSafePathComponent(name: string): boolean {
  return !name.includes("/") && !name.includes("\\");
}

/**
 * Resolve a path and verify it stays within the base directory.
 * @param basePath - The allowed base directory
 * @param relativePath - The relative path to resolve
 * @returns The resolved absolute path
 * @throws Error if the resolved path escapes the base directory
 */
export function resolveAndValidate(
  basePath: string,
  relativePath: string,
): string {
  const normalizedBase = resolve(basePath);
  const resolved = resolve(normalizedBase, relativePath);

  if (!resolved.startsWith(normalizedBase + sep)) {
    throw new Error(
      `Invalid path: '${relativePath}' - path must be within the base directory`,
    );
  }

  return resolved;
}
