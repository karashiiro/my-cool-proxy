/** Events broadcast over the dashboard WebSocket. */
export type DashboardEvent =
  | {
      type: "execution:new";
      executionId: string;
      sessionId: string;
      createdAt: number;
    }
  | {
      type: "execution:completed";
      executionId: string;
      status: "success" | "error";
    }
  | { type: "session:changed" };

/** Handle returned by startDashboardServer for lifecycle management. */
export interface DashboardHandle {
  close: () => Promise<void>;
  broadcast: (event: DashboardEvent) => void;
}

/** Session info returned by the sessions API. */
export interface SessionInfo {
  sessionId: string;
  createdAt: number;
  lastActivity: number;
  capabilities: { sampling: boolean; elicitation: boolean; roots: boolean };
  workingDirectory: string | null;
  connectedServers: string[];
  failedServers: Array<{ name: string; error: string }>;
}
