import { normalize, resolve, dirname, isAbsolute, sep } from "path";
import { realpath, access, constants } from "fs/promises";

/**
 * Error thrown when a path operation violates sandbox constraints.
 * Error messages are intentionally generic to avoid information disclosure.
 */
export class PathSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSandboxError";
    // Preserve prototype chain for instanceof checks
    Object.setPrototypeOf(this, PathSandboxError.prototype);
  }
}

/**
 * Validates that a requested path stays within the sandbox directory.
 *
 * Security measures (per OWASP input-validation guidance):
 * 1. Rejects null bytes (path traversal attack vector)
 * 2. Canonicalizes: path.resolve() handles ".." and "."
 * 3. Normalizes for comparison: path.normalize()
 * 4. Validates against allowlist: verify resolved path starts with sandbox
 *
 * @param requestedPath - The path requested by the caller (relative or absolute)
 * @param sandbox - The sandbox directory (must be an absolute path)
 * @returns The resolved, validated absolute path
 * @throws PathSandboxError if the path escapes the sandbox
 */
export function sandboxPath(requestedPath: string, sandbox: string): string {
  // Validate sandbox is an absolute path
  if (!isAbsolute(sandbox)) {
    throw new PathSandboxError("Sandbox must be an absolute path");
  }

  // Step 1: Reject null bytes (classic path traversal attack vector)
  if (requestedPath.includes("\0")) {
    throw new PathSandboxError("Path contains invalid characters");
  }

  // Step 2: Canonicalize - resolve to absolute path from sandbox
  // path.resolve() handles "..", ".", and relative paths
  const resolvedPath = resolve(sandbox, requestedPath);

  // Step 3: Normalize for consistent comparison
  const normalizedPath = normalize(resolvedPath);
  const normalizedSandbox = normalize(sandbox);

  // Step 4: Validate - ensure the resolved path is within the sandbox
  // Use trailing separator to prevent "/sandbox" matching "/sandbox-other"
  const sandboxPrefix = normalizedSandbox.endsWith(sep)
    ? normalizedSandbox
    : normalizedSandbox + sep;

  // Allow exact match (sandbox itself) or paths under it
  if (
    normalizedPath !== normalizedSandbox &&
    !normalizedPath.startsWith(sandboxPrefix)
  ) {
    throw new PathSandboxError("Path is outside the allowed directory");
  }

  return normalizedPath;
}

/**
 * Validates a path for read operations, with additional symlink resolution.
 *
 * This extends sandboxPath with symlink attack prevention:
 * - Resolves symlinks to their real target using realpath()
 * - Re-validates the resolved target is within the sandbox
 *
 * This prevents attacks where a symlink inside the sandbox points
 * to a file outside it (e.g., /sandbox/link -> /etc/passwd).
 *
 * @param requestedPath - The path requested by the caller
 * @param sandbox - The sandbox directory (must be an absolute path)
 * @returns The resolved, validated absolute path (symlinks resolved)
 * @throws PathSandboxError if the path escapes the sandbox or doesn't exist
 */
export async function sandboxPathForRead(
  requestedPath: string,
  sandbox: string,
): Promise<string> {
  // First, resolve the sandbox's real path
  // This handles cases like macOS /var -> /private/var symlinks
  // and Windows 8.3 short names vs long names
  let realSandbox: string;
  try {
    realSandbox = await realpath(sandbox);
  } catch {
    // If sandbox doesn't exist or can't be resolved, use normalized version
    realSandbox = normalize(sandbox);
  }

  // Validate the path syntactically using the real sandbox path
  const validatedPath = sandboxPath(requestedPath, realSandbox);

  // Then resolve symlinks and re-validate
  // realpath() throws ENOENT if the file doesn't exist
  let realPath: string;
  try {
    realPath = await realpath(validatedPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new PathSandboxError("Path does not exist");
    }
    throw error;
  }

  // Re-validate the real path after symlink resolution
  const normalizedRealPath = normalize(realPath);
  const normalizedSandbox = normalize(realSandbox);
  const sandboxPrefix = normalizedSandbox.endsWith(sep)
    ? normalizedSandbox
    : normalizedSandbox + sep;

  if (
    normalizedRealPath !== normalizedSandbox &&
    !normalizedRealPath.startsWith(sandboxPrefix)
  ) {
    throw new PathSandboxError("Path is outside the allowed directory");
  }

  // On Windows, realpath can return inconsistent forms (8.3 short vs long names)
  // To ensure consistency, reconstruct the path using the realSandbox form
  // by extracting the relative portion from the resolved path
  if (normalizedRealPath === normalizedSandbox) {
    return realSandbox;
  }

  // Get the relative path from sandbox to the resolved path
  const relativePath = normalizedRealPath.slice(sandboxPrefix.length);
  return resolve(realSandbox, relativePath);
}

/**
 * Validates a path for write operations.
 *
 * This extends sandboxPath with write-specific validation:
 * - Validates the parent directory exists and is within the sandbox
 * - Ensures we're not writing to the sandbox root itself
 *
 * @param requestedPath - The path requested by the caller
 * @param sandbox - The sandbox directory (must be an absolute path)
 * @returns The resolved, validated absolute path
 * @throws PathSandboxError if the path escapes the sandbox or parent doesn't exist
 */
export async function sandboxPathForWrite(
  requestedPath: string,
  sandbox: string,
): Promise<string> {
  // First, validate the path syntactically
  const validatedPath = sandboxPath(requestedPath, sandbox);

  // Don't allow writing to the sandbox root itself
  // (only files within it)
  const normalizedPath = normalize(validatedPath);
  const normalizedSandbox = normalize(sandbox);
  if (normalizedPath === normalizedSandbox) {
    throw new PathSandboxError("Cannot write to the sandbox root directory");
  }

  // Validate the parent directory exists and is within sandbox
  const parentDir = dirname(validatedPath);

  // Parent must still be within sandbox
  const parentValidated = sandboxPath(parentDir, sandbox);

  // Check parent directory exists and is accessible
  try {
    await access(parentValidated, constants.F_OK);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new PathSandboxError("Parent directory does not exist");
    }
    throw error;
  }

  return validatedPath;
}
