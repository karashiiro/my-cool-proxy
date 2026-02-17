import { describe, it, beforeAll, afterAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { allocatePort } from "../helpers/port-manager.js";
import { generateHttpTestConfig } from "../helpers/test-config-generator.js";
import { HttpServerManager } from "../helpers/http-server-manager.js";
import { ToyServerManager } from "../helpers/toy-server-manager.js";
import { createCapableGatewayClient } from "../helpers/client-helpers.js";
import { assertTextContains } from "../helpers/test-assertions.js";

describe("Roots Proxy E2E (HTTP Mode)", () => {
  let gatewayPort: number;
  let rootsTesterPort: number;
  let gatewayManager: HttpServerManager;
  let toyServers: ToyServerManager;
  let gatewayClient: Client;
  let configCleanup: () => void;

  beforeAll(async () => {
    // Allocate ports
    gatewayPort = await allocatePort();
    rootsTesterPort = await allocatePort();

    // Start the roots tester toy server
    toyServers = new ToyServerManager();
    await toyServers.startHttp("roots-tester", rootsTesterPort);

    // Generate config with the roots tester server
    const configResult = generateHttpTestConfig({
      port: gatewayPort,
      host: "localhost",
      mcpClients: {
        "roots-test-server": {
          type: "http",
          url: `http://localhost:${rootsTesterPort}/mcp`,
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
        "roots-test-server": {
          type: "http",
          url: `http://localhost:${rootsTesterPort}/mcp`,
        },
      },
    });

    // Create a client WITH roots capability
    // This client will handle roots/list requests forwarded by the proxy
    gatewayClient = await createCapableGatewayClient({
      gatewayPort,
      clientName: "roots-e2e-client",
      roots: true,
      expectedServerCount: 1,
      mockRoots: [
        { uri: "file:///home/user/project", name: "My Project" },
        { uri: "file:///home/user/docs", name: "Documentation" },
      ],
    });
  }, 30000);

  afterAll(async () => {
    await gatewayClient?.close();
    await gatewayManager?.stop();
    await toyServers?.stopAll();
    configCleanup?.();
  });

  describe("Basic Roots Flow", () => {
    it("should list the roots tester server", async () => {
      const result = await gatewayClient.callTool({
        name: "list-servers",
        arguments: {},
      });

      assertTextContains(result, "roots_test_server");
    });

    it("should list roots tester server tools", async () => {
      const result = await gatewayClient.callTool({
        name: "list-server-tools",
        arguments: { luaServerName: "roots_test_server" },
      });

      assertTextContains(result, "call_list_roots");
    });

    it("should proxy roots/list request from upstream to downstream", async () => {
      // Call the call_list_roots tool which triggers a roots/list request
      // The roots/list request goes: toy server -> proxy -> our test client
      // Our test client responds with mock roots
      // The response propagates back through the proxy to the toy server
      const script = `
        local res = roots_test_server.call_list_roots({}):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // The result should contain our mock roots
      assertTextContains(result, "file:///home/user/project");
      assertTextContains(result, "My Project");
      assertTextContains(result, "file:///home/user/docs");
      assertTextContains(result, "Documentation");
    });
  });

  describe("Client Without Roots Capability", () => {
    let noRootsClient: Client;

    beforeAll(async () => {
      // Create a client WITHOUT roots capability
      noRootsClient = await createCapableGatewayClient({
        gatewayPort,
        clientName: "no-roots-client",
        expectedServerCount: 1,
      });
    });

    afterAll(async () => {
      await noRootsClient?.close();
    });

    it("should fail when upstream requests roots from a client without roots capability", async () => {
      const script = `
        local res = roots_test_server.call_list_roots({}):await()
        result(res)
      `;

      const result = await noRootsClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // Should get an error since the client doesn't support roots
      assertTextContains(result, "Error");
    });
  });
});
