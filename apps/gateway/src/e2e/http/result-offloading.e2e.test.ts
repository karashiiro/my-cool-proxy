import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { allocatePort } from "../helpers/port-manager.js";
import { generateHttpTestConfig } from "../helpers/test-config-generator.js";
import { HttpServerManager } from "../helpers/http-server-manager.js";
import { ToyServerManager } from "../helpers/toy-server-manager.js";
import { createGatewayClient } from "../helpers/client-helpers.js";
import {
  getTextString,
  assertTextContains,
  assertIsSuccess,
} from "../helpers/test-assertions.js";

describe("Result Offloading E2E", () => {
  let gatewayPort: number;
  let calculatorPort: number;
  let dataPort: number;
  let gatewayManager: HttpServerManager;
  let toyServers: ToyServerManager;
  let gatewayClient: Client;
  let configCleanup: () => void;

  beforeAll(async () => {
    gatewayPort = await allocatePort();
    calculatorPort = await allocatePort();
    dataPort = await allocatePort();

    toyServers = new ToyServerManager();
    await toyServers.startHttp("calculator", calculatorPort);
    await toyServers.startHttp("data", dataPort);

    // Use a low threshold so Lua-generated results get offloaded
    const configResult = generateHttpTestConfig({
      port: gatewayPort,
      host: "localhost",
      resultSizeThreshold: 500,
      mcpClients: {
        calculator: {
          type: "http",
          url: `http://localhost:${calculatorPort}/mcp`,
        },
        "data-server": {
          type: "http",
          url: `http://localhost:${dataPort}/mcp`,
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
      resultSizeThreshold: 500,
      mcpClients: {
        calculator: {
          type: "http",
          url: `http://localhost:${calculatorPort}/mcp`,
        },
        "data-server": {
          type: "http",
          url: `http://localhost:${dataPort}/mcp`,
        },
      },
    });

    gatewayClient = await createGatewayClient({
      gatewayPort,
      clientName: "offloading-e2e-client",
    });
  }, 30000);

  afterAll(async () => {
    await gatewayClient?.close();
    await gatewayManager?.stop();
    await toyServers?.stopAll();
    configCleanup?.();
  });

  it("should offload large results and allow retrieval via _gateway.get_result()", async () => {
    // Step 1: Execute a script that generates a large result (>500 bytes)
    const generateScript = `
      local items = {}
      for i = 1, 50 do
        table.insert(items, {
          id = i,
          name = "item-" .. tostring(i),
          description = "This is a test item with enough text to exceed the threshold"
        })
      end
      result(items)
    `;

    const offloadResult = await gatewayClient.callTool({
      name: "execute",
      arguments: { script: generateScript },
    });

    assertIsSuccess(offloadResult);
    const offloadText = getTextString(offloadResult);

    // Verify the result was offloaded
    expect(offloadText).toContain("Result offloaded");
    expect(offloadText).toContain("50 items");
    expect(offloadText).toContain("Execution ID:");
    expect(offloadText).toContain("Item structure:");
    expect(offloadText).toContain("_gateway.get_result");

    // Step 2: Extract the execution ID from the offloaded response
    const execIdMatch = offloadText.match(/Execution ID: (\S+)/);
    expect(execIdMatch).not.toBeNull();
    const executionId = execIdMatch![1];

    // Step 3: Retrieve and filter the full data using _gateway.get_result()
    const retrieveScript = `
      local data = _gateway.get_result({ id = "${executionId}" }):await()
      -- Filter: only get first 3 items, selecting specific fields
      local filtered = {}
      for i = 1, math.min(3, #data) do
        table.insert(filtered, { id = data[i].id, name = data[i].name })
      end
      result(filtered)
    `;

    const retrieveResult = await gatewayClient.callTool({
      name: "execute",
      arguments: { script: retrieveScript },
    });

    assertIsSuccess(retrieveResult);
    const retrieveText = getTextString(retrieveResult);

    // The filtered result should be small enough to return inline
    expect(retrieveText).not.toContain("Result offloaded");

    // Parse and verify the actual data
    const parsed = JSON.parse(retrieveText);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({ id: 1, name: "item-1" });
    expect(parsed[1]).toEqual({ id: 2, name: "item-2" });
    expect(parsed[2]).toEqual({ id: 3, name: "item-3" });
  });

  it("should return error when retrieving non-existent execution ID", async () => {
    const script = `
      local data = _gateway.get_result({ id = "nonexistent_99999" }):await()
      result(data)
    `;

    const result = await gatewayClient.callTool({
      name: "execute",
      arguments: { script },
    });

    assertIsSuccess(result);
    assertTextContains(result, "No result found");
  });

  it("should not offload results under the threshold", async () => {
    const script = `
      result({ small = true, count = 42 })
    `;

    const result = await gatewayClient.callTool({
      name: "execute",
      arguments: { script },
    });

    assertIsSuccess(result);
    const text = getTextString(result);
    expect(text).not.toContain("Result offloaded");
    expect(text).toContain("small");
    expect(text).toContain("42");
  });
});
