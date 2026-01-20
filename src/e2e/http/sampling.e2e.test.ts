import { describe, it, beforeAll, afterAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { allocatePort } from "../helpers/port-manager.js";
import { generateHttpTestConfig } from "../helpers/test-config-generator.js";
import { HttpServerManager } from "../helpers/http-server-manager.js";
import { ToyServerManager } from "../helpers/toy-server-manager.js";
import { createCapableGatewayClient } from "../helpers/client-helpers.js";
import { assertTextContains } from "../helpers/test-assertions.js";

describe("Sampling Proxy E2E (HTTP Mode)", () => {
  let gatewayPort: number;
  let samplingServerPort: number;
  let gatewayManager: HttpServerManager;
  let toyServers: ToyServerManager;
  let gatewayClient: Client;
  let configCleanup: () => void;

  beforeAll(async () => {
    // Allocate ports
    gatewayPort = await allocatePort();
    samplingServerPort = await allocatePort();

    // Start the sampling toy server
    toyServers = new ToyServerManager();
    await toyServers.startHttp("sampling", samplingServerPort);

    // Generate config with the sampling server
    const configResult = generateHttpTestConfig({
      port: gatewayPort,
      host: "localhost",
      mcpClients: {
        "sampling-test-server": {
          type: "http",
          url: `http://localhost:${samplingServerPort}/mcp`,
        },
      },
    });
    configCleanup = configResult.cleanup;

    // Set CONFIG_PATH for the gateway to use
    process.env.CONFIG_PATH = configResult.configPath;

    // Start the gateway
    gatewayManager = new HttpServerManager();
    await gatewayManager.start({
      transport: "http",
      port: gatewayPort,
      host: "localhost",
      mcpClients: {
        "sampling-test-server": {
          type: "http",
          url: `http://localhost:${samplingServerPort}/mcp`,
        },
      },
    });

    // Create a client WITH sampling capability
    // This client will handle sampling requests forwarded by the proxy
    gatewayClient = await createCapableGatewayClient({
      gatewayPort,
      clientName: "sampling-e2e-client",
      sampling: true,
    });
  }, 30000);

  afterAll(async () => {
    await gatewayClient?.close();
    await gatewayManager?.stop();
    await toyServers?.stopAll();
    configCleanup?.();
  });

  describe("Basic Sampling Flow", () => {
    it("should list the sampling server", async () => {
      const result = await gatewayClient.callTool({
        name: "list-servers",
        arguments: {},
      });

      assertTextContains(result, "sampling_test_server");
    });

    it("should list sampling server tools", async () => {
      const result = await gatewayClient.callTool({
        name: "list-server-tools",
        arguments: { luaServerName: "sampling_test_server" },
      });

      assertTextContains(result, "ask_llm");
      assertTextContains(result, "multi_turn_llm");
    });

    it("should proxy sampling request from upstream to downstream", async () => {
      // Call the ask_llm tool which triggers a sampling request
      // The sampling request goes: toy server -> proxy -> our test client
      // Our test client responds with mock data
      // The response propagates back through the proxy to the toy server
      const script = `
        local res = sampling_test_server.ask_llm({ question = "What is 2+2?" }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // The result should contain the mock LLM response
      assertTextContains(result, "LLM responded");
      assertTextContains(result, "Mock LLM response");
    });

    it("should handle multi-turn sampling requests", async () => {
      const script = `
        local res = sampling_test_server.multi_turn_llm({
          context = "We are discussing math problems.",
          question = "What comes after addition?"
        }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      assertTextContains(result, "Multi-turn response");
      assertTextContains(result, "Mock LLM response");
    });
  });

  describe("Custom Sampling Responses", () => {
    let customClient: Client;

    beforeAll(async () => {
      // Create a client with a custom mock response
      customClient = await createCapableGatewayClient({
        gatewayPort,
        clientName: "custom-sampling-client",
        sampling: true,
        mockSamplingResponse: "The answer is 42!",
      });
    });

    afterAll(async () => {
      await customClient?.close();
    });

    it("should use custom mock response", async () => {
      const script = `
        local res = sampling_test_server.ask_llm({ question = "What is the meaning of life?" }):await()
        result(res)
      `;

      const result = await customClient.callTool({
        name: "execute",
        arguments: { script },
      });

      assertTextContains(result, "The answer is 42!");
    });
  });
});
