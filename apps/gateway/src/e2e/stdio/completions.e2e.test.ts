import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { generateStdioTestConfig } from "../helpers/test-config-generator.js";
import { getTextString } from "../helpers/test-assertions.js";
import { resolve } from "node:path";

/**
 * Waits for upstream servers to be available by polling list-servers.
 */
async function waitForServersReady(
  client: Client,
  expectedServerCount: number,
  timeoutMs = 10000,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = await client.callTool({
        name: "list-servers",
        arguments: {},
      });

      const content = result.content as Array<{ type: string; text?: string }>;
      const firstContent = content[0];
      if (firstContent && "text" in firstContent && firstContent.text) {
        const text = firstContent.text;
        const match = text.match(/Available MCP Servers: (\d+)/);
        if (
          match &&
          match[1] &&
          parseInt(match[1], 10) >= expectedServerCount
        ) {
          return;
        }
      }
    } catch {
      // Ignore errors during polling
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    `Expected ${expectedServerCount} servers but they did not become ready within ${timeoutMs}ms`,
  );
}

describe("Completions E2E (Stdio Mode)", () => {
  let gatewayClient: Client;
  let configCleanup: () => void;

  beforeAll(async () => {
    const configResult = generateStdioTestConfig({
      transport: "stdio",
      mcpClients: {
        "completions-server": {
          type: "stdio",
          command: "node",
          args: [
            resolve(
              process.cwd(),
              "apps/gateway/dist/e2e/fixtures/toy-servers/completions-server.js",
            ),
          ],
        },
      },
    });
    configCleanup = configResult.cleanup;

    gatewayClient = new Client(
      { name: "completions-stdio-client", version: "1.0.0" },
      { capabilities: {} },
    );

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
  }, 60000);

  afterAll(async () => {
    await gatewayClient?.close();
    configCleanup?.();
  });

  it("should complete prompt language argument via Lua", async () => {
    // List prompts to populate routing
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
        argument = { name = "language", value = "ru" }
      }):await()
      result(res)
    `;

    const result = await gatewayClient.callTool({
      name: "execute",
      arguments: { script },
    });

    const text = getTextString(result);
    expect(text).toContain("rust");
    expect(text).toContain("ruby");
  });

  it("should complete resource template region via MCP protocol", async () => {
    // List resource templates to populate routing
    await gatewayClient.listResourceTemplates();

    const result = await gatewayClient.complete({
      ref: {
        type: "ref/resource",
        uri: "deployment://{region}/{service}",
      },
      argument: { name: "region", value: "ap" },
    });

    expect(result.completion.values).toContain("ap-northeast-1");
    expect(result.completion.values).not.toContain("us-east-1");
  });
});
