import { describe, it, beforeAll, afterAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { allocatePort } from "../helpers/port-manager.js";
import { generateHttpTestConfig } from "../helpers/test-config-generator.js";
import { HttpServerManager } from "../helpers/http-server-manager.js";
import { ToyServerManager } from "../helpers/toy-server-manager.js";
import { createCapableGatewayClient } from "../helpers/client-helpers.js";
import { assertTextContains } from "../helpers/test-assertions.js";

describe("Elicitation Proxy E2E (HTTP Mode)", () => {
  let gatewayPort: number;
  let elicitationServerPort: number;
  let gatewayManager: HttpServerManager;
  let toyServers: ToyServerManager;
  let gatewayClient: Client;
  let configCleanup: () => void;

  beforeAll(async () => {
    // Allocate ports
    gatewayPort = await allocatePort();
    elicitationServerPort = await allocatePort();

    // Start the elicitation toy server
    toyServers = new ToyServerManager();
    await toyServers.startHttp("elicitation", elicitationServerPort);

    // Generate config with the elicitation server
    const configResult = generateHttpTestConfig({
      port: gatewayPort,
      host: "localhost",
      mcpClients: {
        "elicitation-test-server": {
          type: "http",
          url: `http://localhost:${elicitationServerPort}/mcp`,
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
        "elicitation-test-server": {
          type: "http",
          url: `http://localhost:${elicitationServerPort}/mcp`,
        },
      },
    });

    // Create a client WITH elicitation capability
    // This client will handle elicitation requests forwarded by the proxy
    gatewayClient = await createCapableGatewayClient({
      gatewayPort,
      clientName: "elicitation-e2e-client",
      elicitation: true,
    });
  }, 30000);

  afterAll(async () => {
    await gatewayClient?.close();
    await gatewayManager?.stop();
    await toyServers?.stopAll();
    configCleanup?.();
  });

  describe("Basic Elicitation Flow", () => {
    it("should list the elicitation server", async () => {
      const result = await gatewayClient.callTool({
        name: "list-servers",
        arguments: {},
      });

      assertTextContains(result, "elicitation_test_server");
    });

    it("should list elicitation server tools", async () => {
      const result = await gatewayClient.callTool({
        name: "list-server-tools",
        arguments: { luaServerName: "elicitation_test_server" },
      });

      assertTextContains(result, "ask_user_form");
      assertTextContains(result, "ask_user_details");
    });

    it("should proxy form elicitation request from upstream to downstream", async () => {
      // Call the ask_user_form tool which triggers an elicitation request
      // The elicitation request goes: toy server -> proxy -> our test client
      // Our test client responds with mock data (accepts with response: "test-user-input")
      // The response propagates back through the proxy to the toy server
      const script = `
        local res = elicitation_test_server.ask_user_form({ prompt = "What is your name?" }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // The result should contain the mock user input
      assertTextContains(result, "User accepted with response");
      assertTextContains(result, "test-user-input");
    });

    it("should reject elicitation response that doesn't match schema", async () => {
      // The default mock response has { response: "test-user-input" }
      // But ask_user_details requires { name: string, ... }
      // The SDK correctly validates and rejects mismatched responses
      const script = `
        local res = elicitation_test_server.ask_user_details({ prompt = "Please provide your details" }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // The SDK validates the response against the schema and rejects it
      assertTextContains(result, "does not match requested schema");
    });
  });

  describe("Custom Elicitation Responses", () => {
    let customClient: Client;

    beforeAll(async () => {
      // Create a client with a custom mock response
      customClient = await createCapableGatewayClient({
        gatewayPort,
        clientName: "custom-elicitation-client",
        elicitation: true,
        mockElicitationResponse: {
          name: "Alice",
          age: 30,
          confirmed: true,
        },
      });
    });

    afterAll(async () => {
      await customClient?.close();
    });

    it("should use custom mock response for multi-field form", async () => {
      const script = `
        local res = elicitation_test_server.ask_user_details({ prompt = "Tell me about yourself" }):await()
        result(res)
      `;

      const result = await customClient.callTool({
        name: "execute",
        arguments: { script },
      });

      assertTextContains(result, "Alice");
      assertTextContains(result, "30");
    });
  });

  describe("Elicitation Decline", () => {
    let decliningClient: Client;

    beforeAll(async () => {
      // Create a client that declines elicitation requests
      decliningClient = await createCapableGatewayClient({
        gatewayPort,
        clientName: "declining-elicitation-client",
        elicitation: true,
        mockElicitationAction: "decline",
      });
    });

    afterAll(async () => {
      await decliningClient?.close();
    });

    it("should handle declined elicitation", async () => {
      const script = `
        local res = elicitation_test_server.ask_user_form({ prompt = "Please respond" }):await()
        result(res)
      `;

      const result = await decliningClient.callTool({
        name: "execute",
        arguments: { script },
      });

      assertTextContains(result, "declined");
    });
  });
});
