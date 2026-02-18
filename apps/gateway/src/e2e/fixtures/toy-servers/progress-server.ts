import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ProgressToken } from "@modelcontextprotocol/sdk/types.js";
import { serveHttp } from "@karashiiro/mcp/http";
import * as z from "zod";

/**
 * Creates a progress MCP server that emits progress notifications
 * when tools are called. Used for e2e testing of progress forwarding.
 *
 * Because McpServer's registerTool callback doesn't expose _meta.progressToken,
 * this server overrides tools/call at the Protocol level — the same pattern
 * used by the gateway itself.
 */
function createProgressServer(): McpServer {
  const server = new McpServer(
    {
      name: "progress-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Register tools for tools/list (schema discovery).
  // The actual execution is handled by the Protocol-level override below.
  server.registerTool(
    "slow_task",
    {
      description:
        "A slow task that emits incremental progress notifications (0/100 through 100/100)",
      inputSchema: z.object({
        steps: z
          .number()
          .optional()
          .describe("Number of progress steps (default: 5)"),
      }),
    },
    // Placeholder — overridden below
    async () => ({ content: [] }),
  );

  server.registerTool(
    "slow_task_no_total",
    {
      description: "A slow task that emits progress without a total value",
      inputSchema: z.object({
        steps: z
          .number()
          .optional()
          .describe("Number of progress steps (default: 3)"),
      }),
    },
    // Placeholder — overridden below
    async () => ({ content: [] }),
  );

  // Override tools/call at the Protocol level to access progressToken
  server.server.setRequestHandler(
    CallToolRequestSchema,
    async (request, extra) => {
      const toolName = request.params.name;
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      const progressToken = request.params._meta?.progressToken as
        | ProgressToken
        | undefined;

      const sendProgress = (
        progress: number,
        total?: number,
        message?: string,
      ) => {
        if (progressToken === undefined) return;

        const params: Record<string, unknown> = {
          progressToken,
          progress,
        };
        if (total !== undefined) params.total = total;
        if (message !== undefined) params.message = message;

        // Fire-and-forget — don't block tool execution on notification delivery
        extra
          .sendNotification({
            method: "notifications/progress",
            params,
          } as Parameters<typeof extra.sendNotification>[0])
          .catch((err: unknown) => {
            console.warn(
              `[progress-server] Failed to send progress: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      };

      switch (toolName) {
        case "slow_task": {
          const steps = (args.steps as number) || 5;
          const totalWork = 100;
          const stepSize = totalWork / steps;

          for (let i = 0; i < steps; i++) {
            sendProgress(
              Math.round(stepSize * i),
              totalWork,
              `Step ${i + 1}/${steps}`,
            );
            // Small delay so progress notifications can be delivered
            await new Promise((resolve) => setTimeout(resolve, 10));
          }

          // Final progress
          sendProgress(totalWork, totalWork, "Complete");

          return {
            content: [
              {
                type: "text" as const,
                text: `Completed slow task with ${steps} steps`,
              },
            ],
          };
        }

        case "slow_task_no_total": {
          const steps = (args.steps as number) || 3;

          for (let i = 0; i < steps; i++) {
            sendProgress(i + 1, undefined, `Working ${i + 1}`);
            await new Promise((resolve) => setTimeout(resolve, 10));
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `Completed slow task (no total) with ${steps} steps`,
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: "text" as const,
                text: `Unknown tool: ${toolName}`,
              },
            ],
            isError: true,
          };
      }
    },
  );

  return server;
}

/**
 * Starts the progress server in HTTP mode on the specified port
 */
export async function startHttpProgressServer(port: number) {
  return serveHttp(() => createProgressServer(), {
    port,
    host: "localhost",
    endpoint: "/mcp",
    sessions: {},
  });
}
