import envPaths from "env-paths";

export const APP_NAME = "my-cool-proxy";

/**
 * Shared envPaths singleton for the application.
 * Disables the default "-nodejs" suffix to keep paths clean.
 *
 * All modules that need platform-specific directories (config, data, log, etc.)
 * should import from here instead of calling envPaths() independently.
 */
export const appPaths = envPaths(APP_NAME, { suffix: "" });
