import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { allocatePort } from "../helpers/port-manager.js";
import { generateHttpTestConfig } from "../helpers/test-config-generator.js";
import { HttpServerManager } from "../helpers/http-server-manager.js";
import { ToyServerManager } from "../helpers/toy-server-manager.js";
import { createGatewayClient } from "../helpers/client-helpers.js";
import {
  assertTextContains,
  getTextString,
} from "../helpers/test-assertions.js";

describe("Completions E2E (HTTP Mode)", () => {
  let gatewayPort: number;
  let completionsServerPort: number;
  let gatewayManager: HttpServerManager;
  let toyServers: ToyServerManager;
  let gatewayClient: Client;
  let configCleanup: () => void;

  beforeAll(async () => {
    gatewayPort = await allocatePort();
    completionsServerPort = await allocatePort();

    toyServers = new ToyServerManager();
    await toyServers.startHttp("completions", completionsServerPort);

    const configResult = generateHttpTestConfig({
      port: gatewayPort,
      host: "localhost",
      mcpClients: {
        "completions-server": {
          type: "http",
          url: `http://localhost:${completionsServerPort}/mcp`,
        },
      },
    });
    configCleanup = configResult.cleanup;

    process.env.CONFIG_PATH = configResult.configPath;

    gatewayManager = new HttpServerManager();
    await gatewayManager.start({
      transport: "http",
      port: gatewayPort,
      host: "localhost",
      mcpClients: {
        "completions-server": {
          type: "http",
          url: `http://localhost:${completionsServerPort}/mcp`,
        },
      },
    });

    gatewayClient = await createGatewayClient({
      gatewayPort,
      clientName: "completions-e2e-client",
      expectedServerCount: 1,
    });
  }, 30000);

  afterAll(async () => {
    await gatewayClient?.close();
    await gatewayManager?.stop();
    await toyServers?.stopAll();
    configCleanup?.();
  });

  describe("Server Discovery", () => {
    it("should list the completions server", async () => {
      const result = await gatewayClient.callTool({
        name: "list-servers",
        arguments: {},
      });

      assertTextContains(result, "completions_server");
    });

    it("should list completions server tools", async () => {
      const result = await gatewayClient.callTool({
        name: "list-server-tools",
        arguments: { luaServerName: "completions_server" },
      });

      assertTextContains(result, "echo");
    });
  });

  describe("Prompt Argument Completions via Lua", () => {
    it("should complete prompt language argument with prefix filter", async () => {
      // First list prompts to populate routing
      const listScript = `
        local prompts = _gateway.list_prompts():await()
        result(prompts)
      `;
      await gatewayClient.callTool({
        name: "execute",
        arguments: { script: listScript },
      });

      const script = `
        local res = _gateway.complete({
          ref = { type = "ref/prompt", name = "completions-server/code-review" },
          argument = { name = "language", value = "type" }
        }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      const text = getTextString(result);
      expect(text).toContain("typescript");
    });

    it("should complete prompt framework argument with context-aware filtering", async () => {
      const script = `
        local res = _gateway.complete({
          ref = { type = "ref/prompt", name = "completions-server/code-review" },
          argument = { name = "framework", value = "" },
          context = { arguments = { language = "typescript" } }
        }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      const text = getTextString(result);
      // Should return TypeScript frameworks
      expect(text).toContain("express");
      expect(text).toContain("fastify");
      // Should NOT return Python frameworks
      expect(text).not.toContain("django");
      expect(text).not.toContain("flask");
    });
  });

  describe("Resource Template Completions via Lua", () => {
    it("should complete resource template region argument", async () => {
      // First list resource templates to populate routing
      const listScript = `
        local templates = _gateway.list_resource_templates():await()
        result(templates)
      `;
      await gatewayClient.callTool({
        name: "execute",
        arguments: { script: listScript },
      });

      const script = `
        local res = _gateway.complete({
          ref = { type = "ref/resource", uri = "deployment://{region}/{service}" },
          argument = { name = "region", value = "us" }
        }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      const text = getTextString(result);
      expect(text).toContain("us-east-1");
      expect(text).toContain("us-west-2");
      // Should NOT return non-US regions
      expect(text).not.toContain("eu-west-1");
    });

    it("should complete resource template service argument with region context", async () => {
      const script = `
        local res = _gateway.complete({
          ref = { type = "ref/resource", uri = "deployment://{region}/{service}" },
          argument = { name = "service", value = "" },
          context = { arguments = { region = "us-east-1" } }
        }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      const text = getTextString(result);
      // us-east-1 services
      expect(text).toContain("api-gateway");
      expect(text).toContain("billing");
      // Should NOT return eu-west-1-only services
      expect(text).not.toContain("gdpr-service");
    });
  });

  describe("MCP Protocol-Level Completions", () => {
    it("should handle prompt completions via MCP protocol directly", async () => {
      // Ensure prompts are listed first for routing
      await gatewayClient.listPrompts();

      const result = await gatewayClient.complete({
        ref: { type: "ref/prompt", name: "completions-server/code-review" },
        argument: { name: "language", value: "py" },
      });

      expect(result.completion.values).toContain("python");
      expect(result.completion.values).not.toContain("typescript");
    });

    it("should handle resource template completions via MCP protocol directly", async () => {
      // Ensure resource templates are listed first for routing
      await gatewayClient.listResourceTemplates();

      const result = await gatewayClient.complete({
        ref: {
          type: "ref/resource",
          uri: "deployment://{region}/{service}",
        },
        argument: { name: "region", value: "eu" },
      });

      expect(result.completion.values).toContain("eu-west-1");
      expect(result.completion.values).not.toContain("us-east-1");
    });
  });

  describe("Error Handling", () => {
    it("should return error for unnamespaced prompt name", async () => {
      const script = `
        local res = _gateway.complete({
          ref = { type = "ref/prompt", name = "code-review" },
          argument = { name = "language", value = "py" }
        }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // The error gets caught by the builtin and returned as { error: "..." }
      const text = getTextString(result);
      expect(text).toContain("error");
    });

    it("should return error for invalid ref type via Lua", async () => {
      const script = `
        local res = _gateway.complete({
          ref = { type = "ref/invalid", name = "something" },
          argument = { name = "arg", value = "val" }
        }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      const text = getTextString(result);
      expect(text).toContain("error");
      expect(text).toContain("Invalid ref.type");
    });

    it("should return error via MCP protocol for invalid prompt name", async () => {
      await expect(
        gatewayClient.complete({
          ref: { type: "ref/prompt", name: "no-slash-here" },
          argument: { name: "arg", value: "val" },
        }),
      ).rejects.toThrow();
    });
  });
});
