import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Resolves the gateway package root directory (the directory containing
 * package.json) by walking up from the given import.meta.url.
 *
 * Works correctly in both production mode (bundled to dist/index.js)
 * and development mode (tsx running source files from arbitrary depths).
 */
export function resolvePackageRoot(importMetaUrl: string): string {
  let dir = path.dirname(fileURLToPath(importMetaUrl));
  while (true) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find package.json starting from ${path.dirname(fileURLToPath(importMetaUrl))}`,
      );
    }
    dir = parent;
  }
}
