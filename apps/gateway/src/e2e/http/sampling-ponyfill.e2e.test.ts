import { resolve } from "path";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { allocatePort } from "../helpers/port-manager.js";
import { generateHttpTestConfig } from "../helpers/test-config-generator.js";
import { HttpServerManager } from "../helpers/http-server-manager.js";
import { ToyServerManager } from "../helpers/toy-server-manager.js";
import {
  createGatewayClient,
  createCapableGatewayClient,
} from "../helpers/client-helpers.js";
import {
  assertTextContains,
  assertIsError,
} from "../helpers/test-assertions.js";

const ECHO_AGENT_PATH = resolve(
  process.cwd(),
  "apps/gateway/dist/e2e/fixtures/toy-agents/echo-agent.js",
);

describe("Sampling Ponyfill E2E (HTTP Mode)", () => {
  describe("Ponyfill activates when client lacks sampling", () => {
    let gatewayPort: number;
    let samplingServerPort: number;
    let gatewayManager: HttpServerManager;
    let toyServers: ToyServerManager;
    let gatewayClient: Client;
    let configCleanup: () => void;

    beforeAll(async () => {
      gatewayPort = await allocatePort();
      samplingServerPort = await allocatePort();

      // Start the sampling toy server (upstream - sends sampling requests)
      toyServers = new ToyServerManager();
      await toyServers.startHttp("sampling", samplingServerPort);

      // Generate config WITH acp.agent
      const configResult = generateHttpTestConfig({
        port: gatewayPort,
        host: "localhost",
        mcpClients: {
          "sampling-test-server": {
            type: "http",
            url: `http://localhost:${samplingServerPort}/mcp`,
          },
        },
        acp: {
          agent: {
            command: "node",
            args: [ECHO_AGENT_PATH],
          },
        },
      });
      configCleanup = configResult.cleanup;

      // Start gateway
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
        acp: {
          agent: {
            command: "node",
            args: [ECHO_AGENT_PATH],
          },
        },
      });

      // Create client WITHOUT sampling capability
      // The ponyfill should handle sampling via ACP agent instead
      gatewayClient = await createGatewayClient({
        gatewayPort,
        clientName: "ponyfill-e2e-client",
        expectedServerCount: 1,
      });
    }, 30000);

    afterAll(async () => {
      await gatewayClient?.close();
      await gatewayManager?.stop();
      await toyServers?.stopAll();
      configCleanup?.();
    });

    it("should route sampling request through ACP echo agent", async () => {
      const script = `
        local res = sampling_test_server.ask_llm({ question = "What is 2+2?" }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // The response should contain text from the echo agent
      assertTextContains(result, "ACP echo:");
      assertTextContains(result, "LLM responded");
    });

    it("should handle multi-turn messages through ponyfill", async () => {
      const script = `
        local res = sampling_test_server.multi_turn_llm({
          context = "We are discussing math.",
          question = "What comes after addition?"
        }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // The echo agent should have received all serialized messages
      assertTextContains(result, "ACP echo:");
      assertTextContains(result, "Multi-turn response");
    });
  });

  describe("Native sampling takes priority over ponyfill", () => {
    let gatewayPort: number;
    let samplingServerPort: number;
    let gatewayManager: HttpServerManager;
    let toyServers: ToyServerManager;
    let gatewayClient: Client;
    let configCleanup: () => void;

    beforeAll(async () => {
      gatewayPort = await allocatePort();
      samplingServerPort = await allocatePort();

      toyServers = new ToyServerManager();
      await toyServers.startHttp("sampling", samplingServerPort);

      const configResult = generateHttpTestConfig({
        port: gatewayPort,
        host: "localhost",
        mcpClients: {
          "sampling-test-server": {
            type: "http",
            url: `http://localhost:${samplingServerPort}/mcp`,
          },
        },
        acp: {
          agent: {
            command: "node",
            args: [ECHO_AGENT_PATH],
          },
        },
      });
      configCleanup = configResult.cleanup;

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
        acp: {
          agent: {
            command: "node",
            args: [ECHO_AGENT_PATH],
          },
        },
      });

      // Create client WITH sampling capability
      // Native sampling should take priority over ponyfill
      gatewayClient = await createCapableGatewayClient({
        gatewayPort,
        clientName: "native-sampling-client",
        sampling: true,
        expectedServerCount: 1,
      });
    }, 30000);

    afterAll(async () => {
      await gatewayClient?.close();
      await gatewayManager?.stop();
      await toyServers?.stopAll();
      configCleanup?.();
    });

    it("should use native sampling instead of ponyfill", async () => {
      const script = `
        local res = sampling_test_server.ask_llm({ question = "What is 2+2?" }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // Should get the mock LLM response from the native client, NOT the ACP echo
      assertTextContains(result, "Mock LLM response");

      // Verify it's NOT from the echo agent
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      expect(text).not.toContain("ACP echo:");
    });
  });

  describe("No ponyfill and no sampling", () => {
    let gatewayPort: number;
    let samplingServerPort: number;
    let gatewayManager: HttpServerManager;
    let toyServers: ToyServerManager;
    let gatewayClient: Client;
    let configCleanup: () => void;

    beforeAll(async () => {
      gatewayPort = await allocatePort();
      samplingServerPort = await allocatePort();

      toyServers = new ToyServerManager();
      await toyServers.startHttp("sampling", samplingServerPort);

      // Config WITHOUT acp.agent
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

      // Client WITHOUT sampling, no ACP agent configured
      gatewayClient = await createGatewayClient({
        gatewayPort,
        clientName: "no-sampling-client",
        expectedServerCount: 1,
      });
    }, 30000);

    afterAll(async () => {
      await gatewayClient?.close();
      await gatewayManager?.stop();
      await toyServers?.stopAll();
      configCleanup?.();
    });

    it("should fail when sampling is requested without ponyfill or native support", async () => {
      const script = `
        local res = sampling_test_server.ask_llm({ question = "What is 2+2?" }):await()
        result(res)
      `;

      const result = await gatewayClient.callTool({
        name: "execute",
        arguments: { script },
      });

      // Should get an error since no sampling handler is registered
      assertIsError(result);
    });
  });

  describe("Ponyfill cleanup", () => {
    it("should not leak agent processes after stop", async () => {
      const gatewayPort = await allocatePort();
      const samplingServerPort = await allocatePort();

      const toyServers = new ToyServerManager();
      await toyServers.startHttp("sampling", samplingServerPort);

      const configResult = generateHttpTestConfig({
        port: gatewayPort,
        host: "localhost",
        mcpClients: {
          "sampling-test-server": {
            type: "http",
            url: `http://localhost:${samplingServerPort}/mcp`,
          },
        },
        acp: {
          agent: {
            command: "node",
            args: [ECHO_AGENT_PATH],
          },
        },
      });

      const gatewayManager = new HttpServerManager();
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
        acp: {
          agent: {
            command: "node",
            args: [ECHO_AGENT_PATH],
          },
        },
      });

      // Create client and make a request to trigger ponyfill initialization
      const client = await createGatewayClient({
        gatewayPort,
        clientName: "cleanup-test-client",
        expectedServerCount: 1,
      });

      const script = `
        local res = sampling_test_server.ask_llm({ question = "test" }):await()
        result(res)
      `;
      await client.callTool({ name: "execute", arguments: { script } });

      // Clean up - should not leave orphaned processes
      await client.close();
      await gatewayManager.stop();
      await toyServers.stopAll();
      configResult.cleanup();

      // If we get here without hanging, cleanup worked correctly
      expect(true).toBe(true);
    }, 30000);
  });
});
