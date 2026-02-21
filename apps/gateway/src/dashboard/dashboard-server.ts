import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type {
  IExecutionLog,
  ILogger,
  DashboardConfig,
} from "../types/interfaces.js";

/** MIME types for static file serving. Text types include charset=utf-8. */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Clamp a value to the range [min, max].
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Create a Hono app for the dashboard REST API and static file serving.
 *
 * @param executionLog - The execution log to query
 * @param staticDir - Absolute path to the directory containing static dashboard files
 */
export function createDashboardApp(
  executionLog: IExecutionLog,
  staticDir: string,
): Hono {
  const app = new Hono();
  const resolvedStaticDir = path.resolve(staticDir);

  // API routes
  app.get("/api/executions", (c) => {
    const rawLimit = Number(c.req.query("limit") ?? 50);
    const rawOffset = Number(c.req.query("offset") ?? 0);
    const limit = Math.trunc(
      clamp(Number.isFinite(rawLimit) ? rawLimit : 50, 1, 1000),
    );
    const offset = Math.trunc(
      clamp(Number.isFinite(rawOffset) ? rawOffset : 0, 0, Number.MAX_SAFE_INTEGER),
    );
    const executions = executionLog.getAllExecutions(limit, offset);
    const total = executionLog.countExecutions();
    return c.json({ executions, total });
  });

  app.get("/api/executions/:id", (c) => {
    const execution = executionLog.getExecution(c.req.param("id"));
    if (!execution) return c.json({ error: "Not found" }, 404);
    return c.json(execution);
  });

  app.get("/api/executions/:id/tool-calls", (c) => {
    // Verify the execution exists before returning tool calls
    const execution = executionLog.getExecution(c.req.param("id"));
    if (!execution) return c.json({ error: "Not found" }, 404);
    const toolCalls = executionLog.getToolCalls(c.req.param("id"));
    return c.json(toolCalls);
  });

  // Static file serving with SPA fallback (async I/O)
  app.get("/*", async (c) => {
    const requestPath = c.req.path === "/" ? "index.html" : c.req.path;
    const filePath = path.resolve(path.join(resolvedStaticDir, requestPath));

    // Path traversal guard: ensure resolved path is within the static dir
    if (
      !filePath.startsWith(resolvedStaticDir + path.sep) &&
      filePath !== resolvedStaticDir
    ) {
      return c.json({ error: "Forbidden" }, 403);
    }

    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        const content = await fs.readFile(filePath);
        const ext = path.extname(filePath);
        return new Response(content, {
          headers: {
            "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
          },
        });
      }
    } catch {
      // File doesn't exist, fall through to SPA fallback
    }

    // SPA fallback: serve index.html for unmatched routes
    try {
      const indexPath = path.join(resolvedStaticDir, "index.html");
      const indexHtml = await fs.readFile(indexPath);
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch {
      return c.json({ error: "Dashboard UI not found" }, 404);
    }
  });

  return app;
}

/**
 * Start the dashboard HTTP server.
 *
 * @returns A handle with a close() method for graceful shutdown
 */
export async function startDashboardServer(
  executionLog: IExecutionLog,
  config: DashboardConfig,
  staticDir: string,
  logger: ILogger,
): Promise<{ close: () => Promise<void> }> {
  const port = config.port ?? 3100;
  const host = config.host ?? "localhost";
  const app = createDashboardApp(executionLog, staticDir);
  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });
  logger.info({ port, host }, `Dashboard available at http://${host}:${port}`);
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
