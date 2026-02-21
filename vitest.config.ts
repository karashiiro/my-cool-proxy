import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30000, // E2E tests need more time
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // dashboard-ui has its own vitest config (jsdom, svelte plugin)
      "packages/dashboard-ui/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["node_modules/", "**/dist/"],
    },
  },
});
