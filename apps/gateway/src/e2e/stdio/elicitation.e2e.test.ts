import { describe, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { generateStdioTestConfig } from "../helpers/test-config-generator.js";
import {
  waitForServersReady,
  inspectAllTools,
} from "../helpers/client-helpers.js";
import { assertTextContains } from "../helpers/test-assertions.js";
import { resolve } from "node:path";

describe("Elicitation Proxy E2E (Stdio Mode)", () => {
  let gatewayClient: Client;
  let configCleanup: () => void;

  beforeAll(async () => {
    const configResult = generateStdioTestConfig({
      transport: "stdio",
      mcpClients: {
        "elicitation-test-server": {
          type: "stdio",
          command: "node",
          args: [
            resolve(
              process.cwd(),
              "apps/gateway/dist/e2e/fixtures/toy-servers/elicitation-server.js",
            ),
          ],
        },
      },
    });
    configCleanup = configResult.cleanup;

    // Create client with elicitation capabilities (form + URL mode)
    gatewayClient = new Client(
      { name: "elicitation-stdio-client", version: "1.0.0" },
      {
        capabilities: {
          elicitation: {
            form: {},
            url: {},
          },
        },
      },
    );

    // Register handler for elicitation requests — accepts with mock data
    gatewayClient.setRequestHandler(ElicitRequestSchema, async () => {
      return {
        action: "accept" as const,
        content: {
          response: "stdio-test-input",
        },
      };
    });

    const transport = new StdioClientTransport({
      command: "node",
      args: [resolve(process.cwd(), "apps/gateway/dist/index.js")],
      env: {
        ...process.env,
        CONFIG_PATH: configResult.configPath,
      },
    });

    await gatewayClient.connect(transport);

    await waitForServersReady(gatewayClient, 1);
    await inspectAllTools(gatewayClient);
  }, 60000);

  afterAll(async () => {
    await gatewayClient?.close();
    configCleanup?.();
  });

  it("should list elicitation server and tools", async () => {
    const result = await gatewayClient.callTool({
      name: "list-servers",
      arguments: {},
    });

    assertTextContains(result, "elicitation_test_server");

    const toolsResult = await gatewayClient.callTool({
      name: "list-server-tools",
      arguments: { luaServerName: "elicitation_test_server" },
    });

    assertTextContains(toolsResult, "ask_user_form");
    assertTextContains(toolsResult, "ask_user_details");
    assertTextContains(toolsResult, "ask_user_url");
  });

  it("should proxy form elicitation request", async () => {
    const script = `
      local res = elicitation_test_server.ask_user_form({ prompt = "What is your name?" }):await()
      result(res)
    `;

    const result = await gatewayClient.callTool({
      name: "execute",
      arguments: { script },
    });

    assertTextContains(result, "User accepted with response");
    assertTextContains(result, "stdio-test-input");
  });

  it("should proxy URL-mode elicitation request", async () => {
    const script = `
      local res = elicitation_test_server.ask_user_url({
        prompt = "Please authenticate",
        url = "https://example.com/auth"
      }):await()
      result(res)
    `;

    const result = await gatewayClient.callTool({
      name: "execute",
      arguments: { script },
    });

    assertTextContains(result, "User accepted URL elicitation");
    assertTextContains(result, "https://example.com/auth");
  });
});
