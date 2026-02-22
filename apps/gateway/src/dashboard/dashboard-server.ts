import fs from "node:fs/promises";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { IMCPClientManager } from "@my-cool-proxy/mcp-client";
import type {
  IExecutionLog,
  ILogger,
  ICapabilityStore,
  DashboardConfig,
} from "../types/interfaces.js";
import type { SQLiteDatabase } from "../stores/sqlite-database.js";
import type { DashboardHandle, DashboardEvent, SessionInfo } from "./types.js";

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
 * @param clientManager - The MCP client manager for session info
 * @param capabilityStore - Store for session capabilities
 * @param db - SQLite database for session timestamps
 * @param staticDir - Absolute path to the directory containing static dashboard files
 */
export function createDashboardApp(
  executionLog: IExecutionLog,
  clientManager: IMCPClientManager,
  capabilityStore: ICapabilityStore,
  db: SQLiteDatabase,
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
      clamp(
        Number.isFinite(rawOffset) ? rawOffset : 0,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    );
    const tool = c.req.query("tool") || undefined;
    const executions = executionLog.getAllExecutions(limit, offset, tool);
    const total = executionLog.countExecutions(tool);
    return c.json({ executions, total });
  });

  app.get("/api/tools", (c) => {
    const tools = executionLog.getDistinctTools();
    return c.json(tools);
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

  app.get("/api/sessions", (c) => {
    const sessionIds = clientManager.getActiveSessions();

    // Get timestamps from SQLite sessions table
    const rows = db.getSessionTimestamps(sessionIds);
    const timestampMap = new Map(
      rows.map((r) => [
        r.session_id,
        { createdAt: r.created_at, lastActivity: r.last_activity },
      ]),
    );

    const sessions: SessionInfo[] = sessionIds.map((sessionId) => {
      const clients = clientManager.getClientsBySession(sessionId);
      const failed = clientManager.getFailedServers(sessionId);
      const caps = capabilityStore.getCapabilities(sessionId);
      const timestamps = timestampMap.get(sessionId);

      return {
        sessionId,
        createdAt: timestamps?.createdAt ?? 0,
        lastActivity: timestamps?.lastActivity ?? 0,
        capabilities: {
          sampling: !!caps?.sampling,
          elicitation: !!caps?.elicitation,
          roots: !!caps?.roots,
        },
        workingDirectory:
          capabilityStore.getWorkingDirectory(sessionId) ?? null,
        connectedServers: [...clients.keys()],
        failedServers: [...failed.entries()].map(([name, error]) => ({
          name,
          error,
        })),
      };
    });

    return c.json(sessions);
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
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        return c.json({ error: "Internal server error" }, 500);
      }
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
 * Start the dashboard HTTP server with WebSocket support.
 *
 * @returns A handle with close() and broadcast() methods for lifecycle management
 */
export async function startDashboardServer(
  executionLog: IExecutionLog,
  clientManager: IMCPClientManager,
  capabilityStore: ICapabilityStore,
  db: SQLiteDatabase,
  config: DashboardConfig,
  staticDir: string,
  logger: ILogger,
): Promise<DashboardHandle> {
  const port = config.port ?? 3100;
  const host = config.host ?? "localhost";
  const app = createDashboardApp(
    executionLog,
    clientManager,
    capabilityStore,
    db,
    staticDir,
  );
  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  // WebSocket server
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  server.on("upgrade", (request, socket, head) => {
    let pathname: string;
    try {
      const base = `http://${request.headers.host ?? "localhost"}`;
      pathname = new URL(request.url ?? "/", base).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // Heartbeat: ping every 30s, terminate unresponsive after 10s
  const alive = new WeakMap<WebSocket, boolean>();
  wss.on("connection", (ws) => {
    clients.add(ws);
    alive.set(ws, true);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
    ws.on("pong", () => alive.set(ws, true));
  });

  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 30_000);

  const broadcast = (event: DashboardEvent) => {
    const data = JSON.stringify(event);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    }
  };

  logger.info({ port, host }, `Dashboard available at http://${host}:${port}`);

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          logger.warn("Dashboard shutdown timed out, forcing close");
          resolve();
        }, 5_000);

        clearInterval(heartbeat);
        for (const ws of clients) ws.terminate();
        clients.clear();
        wss.close(() => {
          // server.close() only stops accepting new connections — existing
          // keep-alive connections will keep the process alive indefinitely.
          // Force-close them so the callback fires promptly.
          server.closeAllConnections();
          server.close((err) => {
            clearTimeout(timeout);
            if (err) reject(err);
            else resolve();
          });
        });
      }),
    broadcast,
  };
}
