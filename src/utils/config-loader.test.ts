import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { resolve } from "path";
import { loadConfig, mergeEnvConfig } from "./config-loader.js";
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

  it("should throw error if config file not found", () => {
    process.env.CONFIG_PATH = "/nonexistent/path/config.json";

    expect(() => loadConfig()).toThrow(/Configuration file not found/);
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
