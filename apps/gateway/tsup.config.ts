import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardBuildDir = resolve(
  __dirname,
  "../../packages/dashboard-ui/build",
);

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  bundle: true,
  // Bundle all workspace packages into the output
  noExternal: [
    "@my-cool-proxy/acp-client",
    "@my-cool-proxy/logger",
    "@my-cool-proxy/lua-runtime",
    "@my-cool-proxy/mcp-aggregation",
    "@my-cool-proxy/mcp-client",
    "@my-cool-proxy/mcp-sampling-sidecar",
    "@my-cool-proxy/mcp-utilities",
  ],
  // Keep external dependencies external
  external: [
    "@hono/node-server",
    "@inversifyjs/strongly-typed",
    "@karashiiro/mcp",
    "@modelcontextprotocol/sdk",
    "env-paths",
    "hono",
    "inversify",
    "pino",
    "pino-pretty",
    "reflect-metadata",
    "yaml",
    "zod",
    "wasmoon",
  ],
  treeshake: true,
  splitting: false,
  minify: false,
  target: "node22",
  onSuccess: `rm -rf dist/dashboard && cp -r "${dashboardBuildDir}" dist/dashboard`,
});
