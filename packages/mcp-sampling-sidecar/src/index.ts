#!/usr/bin/env node
/**
 * MCP Sampling Sidecar
 *
 * A lightweight MCP server that exposes tools and proxies their execution
 * back to the gateway via HTTP callback. Used by the sampling shim to provide
 * tool support when routing sampling requests through an ACP agent.
 *
 * Environment variables:
 * - TOOLS_JSON: JSON-encoded array of MCP Tool definitions
 * - CALLBACK_URL: HTTP endpoint to POST tool execution requests to
 * - TOOL_TAG: Unique tag appended to tool names for permission matching
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getErrorMessage } from "@my-cool-proxy/mcp-utilities";
import * as z from "zod";

/**
 * Request body sent to the callback URL when a tool is invoked.
 */
interface ToolCallbackRequest {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * Response from the callback server when a tool call is captured.
 * This is part of the spec-compliant sampling-with-tools flow.
 */
interface CapturedResponse {
  status: "captured";
}

/**
 * Main entry point: reads config from env, sets up MCP server, and proxies tool calls.
 */
async function main(): Promise<void> {
  const toolsJson = process.env["TOOLS_JSON"];
  const callbackUrl = process.env["CALLBACK_URL"];
  const toolTag = process.env["TOOL_TAG"];

  if (!toolsJson) {
    console.error("TOOLS_JSON environment variable is required");
    process.exit(1);
  }

  if (!callbackUrl) {
    console.error("CALLBACK_URL environment variable is required");
    process.exit(1);
  }

  if (!toolTag) {
    console.error("TOOL_TAG environment variable is required");
    process.exit(1);
  }

  let tools: Tool[];
  try {
    tools = JSON.parse(toolsJson) as Tool[];
  } catch (e) {
    console.error("Failed to parse TOOLS_JSON:", e);
    process.exit(1);
  }

  // Create the MCP server
  const server = new McpServer(
    {
      name: "sampling-tools",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Silently handle unknown notifications and requests (e.g., custom agent messages)
  // Some agents send custom protocol extensions that we don't need to handle
  server.server.fallbackNotificationHandler = async () => {};
  server.server.fallbackRequestHandler = async () => ({});

  // Register each tool with a handler that calls back to the gateway
  // Tool names are suffixed with the tag for permission matching
  for (const tool of tools) {
    const taggedName = `${tool.name}-${toolTag}`;

    // Use the original JSON Schema but wrap in a passthrough Zod object
    // This tells the SDK what properties to expect AND passes them through
    const properties =
      (tool.inputSchema as { properties?: Record<string, unknown> })
        ?.properties ?? {};
    const schemaShape: Record<string, z.ZodTypeAny> = {};
    for (const key of Object.keys(properties)) {
      schemaShape[key] = z.any();
    }
    const inputSchema = z.object(schemaShape).passthrough();

    server.registerTool(
      taggedName,
      {
        description: tool.description,
        inputSchema,
      },
      async (args): Promise<CallToolResult> => {
        // Use original tool name when calling back to gateway
        const request: ToolCallbackRequest = {
          tool: tool.name,
          args: args as Record<string, unknown>,
        };

        try {
          const response = await fetch(`${callbackUrl}/execute`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
          });

          if (!response.ok) {
            const errorText = await response.text();
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Tool execution failed: ${response.status} ${errorText}`,
                },
              ],
            };
          }

          const result = (await response.json()) as
            | CallToolResult
            | CapturedResponse;

          // SPEC-COMPLIANT: Handle captured response
          // When the callback server captures a tool call (instead of executing),
          // it returns { status: "captured" }. We return an error to stop the agent.
          if ("status" in result && result.status === "captured") {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Tool call captured for delegation to MCP server. The tool "${tool.name}" will be executed by the server.`,
                },
              ],
            };
          }

          return result as CallToolResult;
        } catch (error) {
          const message = getErrorMessage(error);
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Failed to call gateway: ${message}`,
              },
            ],
          };
        }
      },
    );
  }

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep process alive - the transport handles everything
  await new Promise(() => {
    // Never resolves - process runs until killed
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
