import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [
      "**/dist/",
      "**/build/",
      "node_modules/",
      // Dashboard UI uses Svelte files which need a separate eslint plugin
      "packages/dashboard-ui/**/*.svelte",
      "packages/dashboard-ui/.svelte-kit/",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: { globals: globals.node },
  },
  tseslint.configs.recommended,
]);
