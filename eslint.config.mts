import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import sonarjs from "eslint-plugin-sonarjs";
import unusedImports from "eslint-plugin-unused-imports";
import pluginSecurity from "eslint-plugin-security";
import unicorn from "eslint-plugin-unicorn";

export default defineConfig([
  // --- Global ignores ---
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

  // --- Base configs ---
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: { globals: globals.node },
  },
  tseslint.configs.recommended,

  // --- SonarJS recommended preset ---
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    ...sonarjs.configs.recommended,
    rules: {
      ...sonarjs.configs.recommended.rules,
      "sonarjs/cognitive-complexity": ["warn", 15],
      // Disabled: not useful for a server-side app that manages files/processes by design
      "sonarjs/no-clear-text-protocols": "off",
      "sonarjs/publicly-writable-directories": "off",
      "sonarjs/pseudo-random": "off",
      "sonarjs/os-command": "off",
      "sonarjs/no-os-command-from-path": "off",
      "sonarjs/slow-regex": "off",
    },
  },

  // --- Security recommended preset ---
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    ...pluginSecurity.configs.recommended,
    rules: {
      ...pluginSecurity.configs.recommended.rules,
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
    },
  },

  // --- Additional plugins and rules for TS/JS files ---
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: {
      "unused-imports": unusedImports,
      unicorn,
    },
    rules: {
      // unused-imports
      "unused-imports/no-unused-imports": "error",

      // unicorn (cherry-picked)
      "unicorn/prefer-node-protocol": "error",

      // Built-in ESLint rules
      "max-lines-per-function": [
        "warn",
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
      "max-depth": ["warn", 4],
      complexity: ["warn", 15],

      // Disable base max-params in favor of TS version
      "max-params": "off",

      // TypeScript-eslint rules
      "@typescript-eslint/max-params": ["warn", { max: 6 }],
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { objectLiteralTypeAssertions: "never" },
      ],
      "@typescript-eslint/no-non-null-assertion": "warn",
      // method-signature-style disabled: property style activates strict variance
      // checking which is incompatible with cross-package structural typing in this monorepo
      // "@typescript-eslint/method-signature-style": ["error", "property"],
    },
  },

  // --- no-console for non-test TS files ---
  {
    files: ["**/*.{ts,mts,cts}"],
    ignores: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/e2e/**",
      "apps/gateway/src/index.ts",
      "packages/mcp-sampling-sidecar/src/index.ts",
    ],
    rules: {
      "no-console": "error",
    },
  },

  // --- Test file overrides ---
  {
    files: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/e2e/**",
      "**/__tests__/**",
      "**/test/**",
    ],
    rules: {
      "max-lines-per-function": "off",
      "no-console": "off",
      "@typescript-eslint/max-params": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/assertions-in-tests": "off",
      "sonarjs/constructor-for-side-effects": "off",
      "sonarjs/no-element-overwrite": "off",
      "sonarjs/no-identical-functions": "off",
      "sonarjs/use-type-alias": "off",
      "sonarjs/public-static-readonly": "off",
    },
  },

  // --- JS config file overrides (disable TS-only rules) ---
  {
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);
