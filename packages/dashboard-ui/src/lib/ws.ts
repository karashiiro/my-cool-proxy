/** A new execution event broadcast by the gateway. */
export interface ExecutionNewEvent {
  executionId: string;
  sessionId: string;
  createdAt: number;
}

/** Union of all event shapes broadcast over the dashboard WebSocket. */
type DashboardEvent =
  | ({ type: "execution:new" } & ExecutionNewEvent)
  | {
      type: "execution:completed";
      executionId: string;
      status: "success" | "error";
    }
  | { type: "session:changed" };

/** An execution completed event broadcast by the gateway. */
export interface ExecutionCompletedEvent {
  executionId: string;
  status: "success" | "error";
}

/** Public interface for the dashboard WebSocket client. */
export interface DashboardWsClient {
  readonly connected: boolean;
  readonly pendingExecutions: number;
  onExecutionNew(cb: (event: ExecutionNewEvent) => void): () => void;
  onExecutionCompleted(
    cb: (event: ExecutionCompletedEvent) => void,
  ): () => void;
  onSessionChanged(cb: () => void): () => void;
  clearPending(): void;
  close(): void;
}

const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/**
 * Create a dashboard WebSocket client that connects to `/ws` and auto-reconnects
 * with exponential backoff. Returns a client object with reactive getters.
 */
export function createDashboardWs(): DashboardWsClient {
  // Internal mutable state
  let _connected = false;
  let _pendingExecutions = 0;

  let _ws: WebSocket | null = null;
  let _closed = false;
  let _backoffDelay = MIN_DELAY_MS;
  let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const _executionNewListeners = new Set<(event: ExecutionNewEvent) => void>();
  const _executionCompletedListeners = new Set<
    (event: ExecutionCompletedEvent) => void
  >();
  const _sessionChangedListeners = new Set<() => void>();

  function buildWsUrl(): string {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${location.host}/ws`;
  }

  function connect(): void {
    if (_closed) return;

    const ws = new WebSocket(buildWsUrl());
    _ws = ws;

    ws.onopen = () => {
      if (_closed) {
        ws.close();
        return;
      }
      _connected = true;
      _backoffDelay = MIN_DELAY_MS;
    };

    ws.onclose = () => {
      _connected = false;
      _ws = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires immediately after onerror for WebSocket, so no extra
      // action needed here; reconnect is handled in onclose.
    };

    ws.onmessage = (event: MessageEvent) => {
      let data: DashboardEvent;
      try {
        data = JSON.parse(event.data as string) as DashboardEvent;
      } catch {
        return;
      }

      if (data.type === "execution:new") {
        _pendingExecutions++;
        const payload: ExecutionNewEvent = {
          executionId: data.executionId,
          sessionId: data.sessionId,
          createdAt: data.createdAt,
        };
        for (const cb of _executionNewListeners) cb(payload);
      } else if (data.type === "execution:completed") {
        const payload: ExecutionCompletedEvent = {
          executionId: data.executionId,
          status: data.status,
        };
        for (const cb of _executionCompletedListeners) cb(payload);
      } else if (data.type === "session:changed") {
        for (const cb of _sessionChangedListeners) cb();
      }
    };
  }

  function scheduleReconnect(): void {
    if (_closed) return;
    _reconnectTimer = setTimeout(() => {
      _reconnectTimer = null;
      connect();
    }, _backoffDelay);
    _backoffDelay = Math.min(_backoffDelay * 2, MAX_DELAY_MS);
  }

  // Initiate connection immediately (factory connects on creation per spec)
  connect();

  return {
    get connected() {
      return _connected;
    },

    get pendingExecutions() {
      return _pendingExecutions;
    },

    onExecutionNew(cb: (event: ExecutionNewEvent) => void): () => void {
      _executionNewListeners.add(cb);
      return () => {
        _executionNewListeners.delete(cb);
      };
    },

    onExecutionCompleted(
      cb: (event: ExecutionCompletedEvent) => void,
    ): () => void {
      _executionCompletedListeners.add(cb);
      return () => {
        _executionCompletedListeners.delete(cb);
      };
    },

    onSessionChanged(cb: () => void): () => void {
      _sessionChangedListeners.add(cb);
      return () => {
        _sessionChangedListeners.delete(cb);
      };
    },

    clearPending(): void {
      _pendingExecutions = 0;
    },

    close(): void {
      _closed = true;
      if (_reconnectTimer !== null) {
        clearTimeout(_reconnectTimer);
        _reconnectTimer = null;
      }
      if (_ws !== null) {
        _ws.close();
        _ws = null;
      }
    },
  };
}
