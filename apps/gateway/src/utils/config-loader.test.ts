import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, unlinkSync, existsSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { loadConfig, mergeEnvConfig, DEFAULT_CONFIG } from "./config-loader.js";
import type { ServerConfig } from "../types/interfaces.js";

describe("loadConfig", () => {
  const testConfigPath = resolve(process.cwd(), "test-config.json");
  let originalConfigPath: string | undefined;

  beforeEach(() => {
    originalConfigPath = process.env.CONFIG_PATH;
  });

  afterEach(() => {
    // Restore original CONFIG_PATH
    if (originalConfigPath) {
      process.env.CONFIG_PATH = originalConfigPath;
    } else {
      delete process.env.CONFIG_PATH;
    }

    // Clean up test config file
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  it("should load valid config from file", () => {
    const testConfig: ServerConfig = {
      port: 4000,
      host: "0.0.0.0",
      mcpClients: {
        test: { type: "http", url: "http://test.com" },
      },
      transport: "http",
    };

    writeFileSync(testConfigPath, JSON.stringify(testConfig));
    process.env.CONFIG_PATH = testConfigPath;

    const config = loadConfig();
    expect(config).toEqual(testConfig);
  });

  it("should auto-create default config when no config exists", async () => {
    // Reset modules and mock config-paths to simulate no config found anywhere
    vi.resetModules();

    // Create a temp directory for this test
    const tempDir = resolve(tmpdir(), `config-test-${Date.now()}`);
    const mockConfigPath = resolve(tempDir, "auto-created", "config.json");

    vi.doMock("./config-paths.js", () => ({
      getActiveConfigPath: () => null,
      getPlatformConfigPath: () => mockConfigPath,
    }));

    // Suppress console.error output during test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Re-import to get mocked version
    const { loadConfig: mockedLoadConfig } = await import("./config-loader.js");

    const config = mockedLoadConfig();

    // Verify the returned config matches DEFAULT_CONFIG
    expect(config.port).toBe(3000);
    expect(config.host).toBe("localhost");
    expect(config.transport).toBe("http");
    expect(config.mcpClients).toEqual({});

    // Verify the file was created
    expect(existsSync(mockConfigPath)).toBe(true);

    // Cleanup
    consoleSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
    vi.doUnmock("./config-paths.js");
    vi.resetModules();
  });

  it("should create parent directories when auto-creating config", async () => {
    vi.resetModules();

    // Create a deeply nested path
    const tempDir = resolve(tmpdir(), `config-test-${Date.now()}`);
    const nestedPath = resolve(
      tempDir,
      "deeply",
      "nested",
      "dir",
      "config.json",
    );

    vi.doMock("./config-paths.js", () => ({
      getActiveConfigPath: () => null,
      getPlatformConfigPath: () => nestedPath,
    }));

    // Suppress console.error output during test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { loadConfig: mockedLoadConfig } = await import("./config-loader.js");
    mockedLoadConfig();

    // Verify the file was created in the nested directory
    expect(existsSync(nestedPath)).toBe(true);

    // Cleanup
    consoleSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
    vi.doUnmock("./config-paths.js");
    vi.resetModules();
  });

  it("should log helpful message when auto-creating config", async () => {
    vi.resetModules();

    const tempDir = resolve(tmpdir(), `config-test-${Date.now()}`);
    const mockConfigPath = resolve(tempDir, "log-test", "config.json");

    vi.doMock("./config-paths.js", () => ({
      getActiveConfigPath: () => null,
      getPlatformConfigPath: () => mockConfigPath,
    }));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { loadConfig: mockedLoadConfig } = await import("./config-loader.js");
    mockedLoadConfig();

    // Verify helpful messages were logged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Created default config"),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("configuration.md"),
    );

    // Cleanup
    consoleSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
    vi.doUnmock("./config-paths.js");
    vi.resetModules();
  });

  it("should throw error if port is not a number", () => {
    const invalidConfig = {
      port: "invalid",
      host: "localhost",
      mcpClients: {},
    };

    writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
    process.env.CONFIG_PATH = testConfigPath;

    expect(() => loadConfig()).toThrow(/must specify 'port' as a number/);
  });

  it("should throw error if host is not a string", () => {
    const invalidConfig = {
      port: 3000,
      host: 123,
      mcpClients: {},
    };

    writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
    process.env.CONFIG_PATH = testConfigPath;

    expect(() => loadConfig()).toThrow(/must specify 'host' as a string/);
  });

  it("should throw error if mcpClients is not an object", () => {
    const invalidConfig = {
      port: 3000,
      host: "localhost",
      mcpClients: "invalid",
    };

    writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
    process.env.CONFIG_PATH = testConfigPath;

    expect(() => loadConfig()).toThrow(
      /must specify 'mcpClients' as an object/,
    );
  });

  it("should throw error if mcpClients is an array", () => {
    const invalidConfig = {
      port: 3000,
      host: "localhost",
      mcpClients: [],
    };

    writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
    process.env.CONFIG_PATH = testConfigPath;

    expect(() => loadConfig()).toThrow(
      /must specify 'mcpClients' as an object/,
    );
  });

  it("should throw error if client has invalid type", () => {
    const invalidConfig = {
      port: 3000,
      host: "localhost",
      mcpClients: {
        test: { type: "invalid", url: "http://test.com" },
      },
    };

    writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
    process.env.CONFIG_PATH = testConfigPath;

    expect(() => loadConfig()).toThrow(
      /has invalid type. Must be 'http' or 'stdio'/,
    );
  });

  it("should throw error if http client is missing url", () => {
    const invalidConfig = {
      port: 3000,
      host: "localhost",
      mcpClients: {
        test: { type: "http" },
      },
    };

    writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
    process.env.CONFIG_PATH = testConfigPath;

    expect(() => loadConfig()).toThrow(
      /with type 'http' must specify 'url' as a string/,
    );
  });

  it("should throw error if stdio client is missing command", () => {
    const invalidConfig = {
      port: 3000,
      host: "localhost",
      mcpClients: {
        test: { type: "stdio" },
      },
    };

    writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
    process.env.CONFIG_PATH = testConfigPath;

    expect(() => loadConfig()).toThrow(
      /with type 'stdio' must specify 'command' as a string/,
    );
  });

  it("should accept valid http client config", () => {
    const validConfig = {
      port: 3000,
      host: "localhost",
      mcpClients: {
        docs: { type: "http", url: "https://example.com" },
      },
    };

    writeFileSync(testConfigPath, JSON.stringify(validConfig));
    process.env.CONFIG_PATH = testConfigPath;

    const config = loadConfig();
    expect(config.mcpClients.docs).toEqual({
      type: "http",
      url: "https://example.com",
    });
  });

  it("should accept valid stdio client config", () => {
    const validConfig = {
      port: 3000,
      host: "localhost",
      mcpClients: {
        local: {
          type: "stdio",
          command: "node",
          args: ["server.js"],
          env: { NODE_ENV: "test" },
        },
      },
    };

    writeFileSync(testConfigPath, JSON.stringify(validConfig));
    process.env.CONFIG_PATH = testConfigPath;

    const config = loadConfig();
    expect(config.mcpClients.local).toEqual({
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: { NODE_ENV: "test" },
    });
  });

  it("should throw error if JSON is invalid", () => {
    writeFileSync(testConfigPath, "{ invalid json }");
    process.env.CONFIG_PATH = testConfigPath;

    expect(() => loadConfig()).toThrow(/Invalid JSON in config file/);
  });

  describe("dangerouslyEnableSampling validation", () => {
    it("should accept dangerouslyEnableSampling: true", () => {
      const validConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {
          trusted: {
            type: "http",
            url: "http://example.com",
            dangerouslyEnableSampling: true,
          },
        },
      };

      writeFileSync(testConfigPath, JSON.stringify(validConfig));
      process.env.CONFIG_PATH = testConfigPath;

      const config = loadConfig();
      expect(config.mcpClients.trusted?.dangerouslyEnableSampling).toBe(true);
    });

    it("should accept dangerouslyEnableSampling: false", () => {
      const validConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {
          untrusted: {
            type: "stdio",
            command: "node",
            dangerouslyEnableSampling: false,
          },
        },
      };

      writeFileSync(testConfigPath, JSON.stringify(validConfig));
      process.env.CONFIG_PATH = testConfigPath;

      const config = loadConfig();
      expect(config.mcpClients.untrusted?.dangerouslyEnableSampling).toBe(
        false,
      );
    });

    it("should accept omitted dangerouslyEnableSampling (undefined)", () => {
      const validConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {
          server: {
            type: "http",
            url: "http://example.com",
          },
        },
      };

      writeFileSync(testConfigPath, JSON.stringify(validConfig));
      process.env.CONFIG_PATH = testConfigPath;

      const config = loadConfig();
      expect(
        config.mcpClients.server?.dangerouslyEnableSampling,
      ).toBeUndefined();
    });

    it("should reject dangerouslyEnableSampling as string", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {
          bad: {
            type: "http",
            url: "http://example.com",
            dangerouslyEnableSampling: "true", // string, not boolean
          },
        },
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /MCP client 'bad' has invalid 'dangerouslyEnableSampling'. Must be a boolean \(true or false\)/,
      );
    });

    it("should reject dangerouslyEnableSampling as number", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {
          bad: {
            type: "stdio",
            command: "node",
            dangerouslyEnableSampling: 1, // number, not boolean
          },
        },
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /MCP client 'bad' has invalid 'dangerouslyEnableSampling'. Must be a boolean \(true or false\)/,
      );
    });
  });

  describe("acp config validation", () => {
    it("should accept valid acp config with agent", () => {
      const validConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        acp: {
          agent: {
            command: "node",
            args: ["agent.js"],
            env: { MODEL: "gpt-4" },
          },
        },
      };

      writeFileSync(testConfigPath, JSON.stringify(validConfig));
      process.env.CONFIG_PATH = testConfigPath;

      const config = loadConfig();
      expect(config.acp).toEqual(validConfig.acp);
    });

    it("should accept acp config with only command", () => {
      const validConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        acp: {
          agent: {
            command: "my-agent",
          },
        },
      };

      writeFileSync(testConfigPath, JSON.stringify(validConfig));
      process.env.CONFIG_PATH = testConfigPath;

      const config = loadConfig();
      expect(config.acp?.agent?.command).toBe("my-agent");
    });

    it("should accept empty acp config (no agent)", () => {
      const validConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        acp: {},
      };

      writeFileSync(testConfigPath, JSON.stringify(validConfig));
      process.env.CONFIG_PATH = testConfigPath;

      const config = loadConfig();
      expect(config.acp).toEqual({});
    });

    it("should throw error if acp is not an object", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        acp: "invalid",
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /Config 'acp' must be an object if specified/,
      );
    });

    it("should throw error if acp.agent is not an object", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        acp: { agent: "invalid" },
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /Config 'acp.agent' must be an object if specified/,
      );
    });

    it("should throw error if acp.agent is missing command", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        acp: { agent: { args: ["test"] } },
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /Config 'acp.agent' must specify 'command' as a string/,
      );
    });

    it("should throw error if acp.agent.args is not an array", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        acp: { agent: { command: "node", args: "invalid" } },
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /Config 'acp.agent.args' must be an array if specified/,
      );
    });

    it("should throw error if acp.agent.args contains non-strings", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        acp: { agent: { command: "node", args: [123] } },
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /Config 'acp.agent.args' must contain only strings/,
      );
    });

    it("should throw error if acp.agent.env is not an object", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        acp: { agent: { command: "node", env: "invalid" } },
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /Config 'acp.agent.env' must be an object if specified/,
      );
    });

    it("should throw error if acp.agent.env contains non-string values", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        acp: { agent: { command: "node", env: { BAD: 123 } } },
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /Config 'acp.agent.env.BAD' must be a string/,
      );
    });
  });

  describe("logging config validation", () => {
    it("should accept valid logging config with console level", () => {
      const validConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        logging: {
          console: { level: "debug" },
        },
      };

      writeFileSync(testConfigPath, JSON.stringify(validConfig));
      process.env.CONFIG_PATH = testConfigPath;

      const config = loadConfig();
      expect(config.logging?.console?.level).toBe("debug");
    });

    it("should accept valid logging config with file level", () => {
      const validConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        logging: {
          file: { level: "warn" },
        },
      };

      writeFileSync(testConfigPath, JSON.stringify(validConfig));
      process.env.CONFIG_PATH = testConfigPath;

      const config = loadConfig();
      expect(config.logging?.file?.level).toBe("warn");
    });

    it("should accept valid logging config with both console and file", () => {
      const validConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        logging: {
          console: { level: "info" },
          file: { level: "trace" },
        },
      };

      writeFileSync(testConfigPath, JSON.stringify(validConfig));
      process.env.CONFIG_PATH = testConfigPath;

      const config = loadConfig();
      expect(config.logging?.console?.level).toBe("info");
      expect(config.logging?.file?.level).toBe("trace");
    });

    it("should accept empty logging config", () => {
      const validConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        logging: {},
      };

      writeFileSync(testConfigPath, JSON.stringify(validConfig));
      process.env.CONFIG_PATH = testConfigPath;

      const config = loadConfig();
      expect(config.logging).toEqual({});
    });

    it("should accept all valid log levels", () => {
      const levels = ["trace", "debug", "info", "warn", "error", "fatal"];

      for (const level of levels) {
        const validConfig = {
          port: 3000,
          host: "localhost",
          mcpClients: {},
          logging: {
            console: { level },
          },
        };

        writeFileSync(testConfigPath, JSON.stringify(validConfig));
        process.env.CONFIG_PATH = testConfigPath;

        const config = loadConfig();
        expect(config.logging?.console?.level).toBe(level);
      }
    });

    it("should throw error if logging is not an object", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        logging: "invalid",
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /Config 'logging' must be an object if specified/,
      );
    });

    it("should throw error if logging.console is not an object", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        logging: { console: "invalid" },
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /Config 'logging.console' must be an object if specified/,
      );
    });

    it("should throw error if logging.file is not an object", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        logging: { file: "invalid" },
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /Config 'logging.file' must be an object if specified/,
      );
    });

    it("should throw error if logging.console.level is invalid", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        logging: { console: { level: "invalid" } },
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /Config 'logging.console.level' must be one of: trace, debug, info, warn, error, fatal/,
      );
    });

    it("should throw error if logging.file.level is invalid", () => {
      const invalidConfig = {
        port: 3000,
        host: "localhost",
        mcpClients: {},
        logging: { file: { level: "verbose" } },
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      process.env.CONFIG_PATH = testConfigPath;

      expect(() => loadConfig()).toThrow(
        /Config 'logging.file.level' must be one of: trace, debug, info, warn, error, fatal/,
      );
    });
  });
});

describe("mergeEnvConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should keep config values when no env vars are set", () => {
    delete process.env.PORT;
    delete process.env.HOST;

    const baseConfig: ServerConfig = {
      port: 3000,
      host: "localhost",
      mcpClients: {},
    };

    const result = mergeEnvConfig(baseConfig);
    expect(result).toEqual(baseConfig);
  });

  it("should override port from PORT env var", () => {
    process.env.PORT = "8080";

    const baseConfig: ServerConfig = {
      port: 3000,
      host: "localhost",
      mcpClients: {},
    };

    const result = mergeEnvConfig(baseConfig);
    expect(result.port).toBe(8080);
  });

  it("should override host from HOST env var", () => {
    process.env.HOST = "0.0.0.0";

    const baseConfig: ServerConfig = {
      port: 3000,
      host: "localhost",
      mcpClients: {},
    };

    const result = mergeEnvConfig(baseConfig);
    expect(result.host).toBe("0.0.0.0");
  });

  it("should override all config values from env vars", () => {
    process.env.PORT = "9000";
    process.env.HOST = "example.com";

    const baseConfig: ServerConfig = {
      port: 3000,
      host: "localhost",
      mcpClients: { test: { type: "http", url: "http://test.com" } },
    };

    const result = mergeEnvConfig(baseConfig);
    expect(result).toEqual({
      port: 9000,
      host: "example.com",
      mcpClients: { test: { type: "http", url: "http://test.com" } },
    });
  });

  it("should preserve mcpClients object", () => {
    const baseConfig: ServerConfig = {
      port: 3000,
      host: "localhost",
      mcpClients: {
        server1: { type: "http", url: "http://server1.com" },
        server2: { type: "stdio", command: "node", args: ["server.js"] },
      },
    };

    const result = mergeEnvConfig(baseConfig);
    expect(result.mcpClients).toEqual(baseConfig.mcpClients);
  });
});

describe("validateDashboardConfig", () => {
  const testConfigPath = resolve(process.cwd(), "test-dashboard-config.json");
  let originalConfigPath: string | undefined;

  beforeEach(() => {
    originalConfigPath = process.env.CONFIG_PATH;
    process.env.CONFIG_PATH = testConfigPath;
  });

  afterEach(() => {
    if (originalConfigPath) {
      process.env.CONFIG_PATH = originalConfigPath;
    } else {
      delete process.env.CONFIG_PATH;
    }
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  it("should accept valid dashboard config", () => {
    const config = {
      port: 3000,
      host: "localhost",
      transport: "http",
      mcpClients: {},
      dashboard: { port: 3100, host: "localhost" },
    };
    writeFileSync(testConfigPath, JSON.stringify(config));
    expect(() => loadConfig()).not.toThrow();
  });

  it("should accept empty dashboard config (uses defaults)", () => {
    const config = {
      port: 3000,
      host: "localhost",
      transport: "http",
      mcpClients: {},
      dashboard: {},
    };
    writeFileSync(testConfigPath, JSON.stringify(config));
    expect(() => loadConfig()).not.toThrow();
  });

  it("should accept config without dashboard section", () => {
    const config = {
      port: 3000,
      host: "localhost",
      transport: "http",
      mcpClients: {},
    };
    writeFileSync(testConfigPath, JSON.stringify(config));
    expect(() => loadConfig()).not.toThrow();
  });

  it("should reject non-object dashboard config", () => {
    const config = {
      port: 3000,
      host: "localhost",
      transport: "http",
      mcpClients: {},
      dashboard: "yes",
    };
    writeFileSync(testConfigPath, JSON.stringify(config));
    expect(() => loadConfig()).toThrow("must be an object");
  });

  it("should reject non-number port", () => {
    const config = {
      port: 3000,
      host: "localhost",
      transport: "http",
      mcpClients: {},
      dashboard: { port: "abc" },
    };
    writeFileSync(testConfigPath, JSON.stringify(config));
    expect(() => loadConfig()).toThrow("must be a number");
  });

  it("should reject non-string host", () => {
    const config = {
      port: 3000,
      host: "localhost",
      transport: "http",
      mcpClients: {},
      dashboard: { host: 123 },
    };
    writeFileSync(testConfigPath, JSON.stringify(config));
    expect(() => loadConfig()).toThrow("must be a string");
  });

  it("should reject out-of-range dashboard port", () => {
    const config = {
      port: 3000,
      host: "localhost",
      transport: "http",
      mcpClients: {},
      dashboard: { port: 70000 },
    };
    writeFileSync(testConfigPath, JSON.stringify(config));
    expect(() => loadConfig()).toThrow("between 1 and 65535");
  });

  it("should reject negative dashboard port", () => {
    const config = {
      port: 3000,
      host: "localhost",
      transport: "http",
      mcpClients: {},
      dashboard: { port: -1 },
    };
    writeFileSync(testConfigPath, JSON.stringify(config));
    expect(() => loadConfig()).toThrow("between 1 and 65535");
  });

  it("should reject non-integer dashboard port", () => {
    const config = {
      port: 3000,
      host: "localhost",
      transport: "http",
      mcpClients: {},
      dashboard: { port: 3.14 },
    };
    writeFileSync(testConfigPath, JSON.stringify(config));
    expect(() => loadConfig()).toThrow("between 1 and 65535");
  });
});

describe("DEFAULT_CONFIG", () => {
  it("should have expected default values", () => {
    expect(DEFAULT_CONFIG).toEqual({
      port: 3000,
      host: "localhost",
      transport: "http",
      mcpClients: {},
    });
  });

  it("should have empty mcpClients object", () => {
    expect(DEFAULT_CONFIG.mcpClients).toEqual({});
    expect(Object.keys(DEFAULT_CONFIG.mcpClients)).toHaveLength(0);
  });
});
