import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerConfig } from "../../types/interfaces.js";

/**
 * Test skill definition for e2e tests
 */
export interface TestSkillDefinition {
  name: string;
  content: string;
  resources?: Record<string, string>;
}

/**
 * Options for generating test configuration
 */
export interface TestConfigOptions {
  config: ServerConfig;
  skills?: TestSkillDefinition[];
}

/**
 * Generates a test configuration file and returns its path.
 * The config file will be created in a temporary directory.
 *
 * @param config - The server configuration to write
 * @param skills - Optional array of test skills to create
 * @returns Object containing the config path and cleanup function
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export function generateTestConfig(
  config: ServerConfig,
  skills?: TestSkillDefinition[],
): {
  configPath: string;
  tempDir: string;
  cleanup: () => void;
} {
  // Create a temporary directory
  const tempDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  const configPath = join(tempDir, "config.json");

  // Write config to file
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

  // Create skills directory and skills if provided
  if (skills && skills.length > 0) {
    const skillsDir = join(tempDir, "skills");
    mkdirSync(skillsDir, { recursive: true });

    for (const skill of skills) {
      const skillDir = join(skillsDir, skill.name);
      mkdirSync(skillDir, { recursive: true });

      // Write SKILL.md
      writeFileSync(join(skillDir, "SKILL.md"), skill.content, "utf-8");

      // Write additional resources if provided
      if (skill.resources) {
        for (const [path, content] of Object.entries(skill.resources)) {
          const fullPath = join(skillDir, path);
          const dir = dirname(fullPath);
          // eslint-disable-next-line max-depth
          if (dir && dir !== skillDir) {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(fullPath, content, "utf-8");
        }
      }
    }
  }

  return {
    configPath,
    tempDir,
    cleanup: () => {
      try {
        // Clean up entire temp directory
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Helper to generate an HTTP mode test configuration
 */
export function generateHttpTestConfig(
  overrides: Partial<ServerConfig> = {},
  skills?: TestSkillDefinition[],
) {
  const config: ServerConfig = {
    transport: "http",
    port: 3000,
    host: "localhost",
    mcpClients: {},
    ...overrides,
  };
  return generateTestConfig(config, skills);
}

/**
 * Helper to generate a stdio mode test configuration
 */
export function generateStdioTestConfig(
  overrides: Partial<ServerConfig> = {},
  skills?: TestSkillDefinition[],
) {
  const config: ServerConfig = {
    transport: "stdio",
    mcpClients: {},
    ...overrides,
  };
  return generateTestConfig(config, skills);
}
