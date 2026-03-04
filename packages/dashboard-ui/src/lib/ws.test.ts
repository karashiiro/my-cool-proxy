import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDashboardWs } from "./ws.js";

// ---------------------------------------------------------------------------
// MockWebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  static instances: MockWebSocket[] = [];

  readyState: number = MockWebSocket.CONNECTING;
  url: string;

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  /** Simulate a successful connection open. */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  /** Simulate the server closing / dropping the connection. */
  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  /** Simulate an incoming message with arbitrary data. */
  simulateMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  /** Simulate a socket error (onclose will fire right after per spec). */
  simulateError(): void {
    this.onerror?.({} as Event);
    this.simulateClose();
  }

  /** Most recent instance created (convenience accessor). */
  static get latest(): MockWebSocket {
    const instance =
      MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!instance) throw new Error("No MockWebSocket instances created");
    return instance;
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("createDashboardWs", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:3000" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // 1. Creates WebSocket connection to correct URL
  it("creates a WebSocket connection to the correct URL", () => {
    const client = createDashboardWs();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.latest.url).toBe("ws://localhost:3000/ws");
    client.close();
  });

  it("uses wss:// when the page is served over HTTPS", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "example.com" });
    const client = createDashboardWs();
    expect(MockWebSocket.latest.url).toBe("wss://example.com/ws");
    client.close();
  });

  // 2. Sets connected=true when socket opens
  it("sets connected=true when the socket opens", () => {
    const client = createDashboardWs();
    expect(client.connected).toBe(false);
    MockWebSocket.latest.simulateOpen();
    expect(client.connected).toBe(true);
    client.close();
  });

  // 3. Sets connected=false when socket closes
  it("sets connected=false when the socket closes", () => {
    vi.useFakeTimers();
    const client = createDashboardWs();
    MockWebSocket.latest.simulateOpen();
    expect(client.connected).toBe(true);
    MockWebSocket.latest.simulateClose();
    expect(client.connected).toBe(false);
    client.close();
  });

  // 4. Increments pendingExecutions on execution:new
  it("increments pendingExecutions on execution:new events", () => {
    const client = createDashboardWs();
    MockWebSocket.latest.simulateOpen();
    expect(client.pendingExecutions).toBe(0);

    MockWebSocket.latest.simulateMessage({
      type: "execution:new",
      executionId: "e1",
      sessionId: "s1",
      createdAt: 1000,
    });
    expect(client.pendingExecutions).toBe(1);

    MockWebSocket.latest.simulateMessage({
      type: "execution:new",
      executionId: "e2",
      sessionId: "s1",
      createdAt: 2000,
    });
    expect(client.pendingExecutions).toBe(2);
    client.close();
  });

  // 5. Fires onExecutionNew callbacks on execution:new
  it("fires onExecutionNew callbacks on execution:new events", () => {
    const client = createDashboardWs();
    MockWebSocket.latest.simulateOpen();

    const cb = vi.fn();
    client.onExecutionNew(cb);

    MockWebSocket.latest.simulateMessage({
      type: "execution:new",
      executionId: "e1",
      sessionId: "s1",
      createdAt: 1234,
    });

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({
      executionId: "e1",
      sessionId: "s1",
      createdAt: 1234,
    });
    client.close();
  });

  it("fires onExecutionCompleted callbacks with correct payload on execution:completed events", () => {
    const client = createDashboardWs();
    MockWebSocket.latest.simulateOpen();

    const newCb = vi.fn();
    const completedCb = vi.fn();
    client.onExecutionNew(newCb);
    client.onExecutionCompleted(completedCb);

    MockWebSocket.latest.simulateMessage({
      type: "execution:completed",
      executionId: "e1",
      status: "success",
    });

    expect(newCb).not.toHaveBeenCalled();
    expect(completedCb).toHaveBeenCalledOnce();
    expect(completedCb).toHaveBeenCalledWith({
      executionId: "e1",
      status: "success",
    });
    client.close();
  });

  // 6. Fires onSessionChanged callbacks on session:changed
  it("fires onSessionChanged callbacks on session:changed events", () => {
    const client = createDashboardWs();
    MockWebSocket.latest.simulateOpen();

    const cb = vi.fn();
    client.onSessionChanged(cb);

    MockWebSocket.latest.simulateMessage({ type: "session:changed" });

    expect(cb).toHaveBeenCalledOnce();
    client.close();
  });

  // 7. clearPending() resets pendingExecutions to 0
  it("clearPending() resets pendingExecutions to 0", () => {
    const client = createDashboardWs();
    MockWebSocket.latest.simulateOpen();

    MockWebSocket.latest.simulateMessage({
      type: "execution:new",
      executionId: "e1",
      sessionId: "s1",
      createdAt: 1000,
    });
    MockWebSocket.latest.simulateMessage({
      type: "execution:new",
      executionId: "e2",
      sessionId: "s1",
      createdAt: 2000,
    });
    expect(client.pendingExecutions).toBe(2);

    client.clearPending();
    expect(client.pendingExecutions).toBe(0);
    client.close();
  });

  // 8. close() closes WebSocket and stops reconnect
  it("close() closes the WebSocket and prevents reconnection", () => {
    vi.useFakeTimers();
    const client = createDashboardWs();
    const ws = MockWebSocket.latest;
    ws.simulateOpen();

    client.close();
    expect(ws.close).toHaveBeenCalled();

    // Simulate server closing after our close call — no new socket should appear
    ws.simulateClose();
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  // 9. Unsubscribe function removes callback
  it("unsubscribe function removes the callback from future events", () => {
    const client = createDashboardWs();
    MockWebSocket.latest.simulateOpen();

    const cb = vi.fn();
    const unsubscribe = client.onExecutionNew(cb);

    MockWebSocket.latest.simulateMessage({
      type: "execution:new",
      executionId: "e1",
      sessionId: "s1",
      createdAt: 1000,
    });
    expect(cb).toHaveBeenCalledOnce();

    unsubscribe();

    MockWebSocket.latest.simulateMessage({
      type: "execution:new",
      executionId: "e2",
      sessionId: "s1",
      createdAt: 2000,
    });
    expect(cb).toHaveBeenCalledOnce(); // still only one call
    client.close();
  });

  it("unsubscribe function removes session:changed callback", () => {
    const client = createDashboardWs();
    MockWebSocket.latest.simulateOpen();

    const cb = vi.fn();
    const unsubscribe = client.onSessionChanged(cb);

    MockWebSocket.latest.simulateMessage({ type: "session:changed" });
    expect(cb).toHaveBeenCalledOnce();

    unsubscribe();

    MockWebSocket.latest.simulateMessage({ type: "session:changed" });
    expect(cb).toHaveBeenCalledOnce();
    client.close();
  });

  // 10. Reconnects after connection closes (exponential backoff)
  it("reconnects after connection drops using exponential backoff", () => {
    vi.useFakeTimers();
    const client = createDashboardWs();

    // First connection opens then closes unexpectedly
    MockWebSocket.latest.simulateOpen();
    MockWebSocket.latest.simulateClose();
    expect(MockWebSocket.instances).toHaveLength(1);

    // After 1s (initial backoff) a new socket should appear
    vi.advanceTimersByTime(1_000);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Second connection drops immediately
    MockWebSocket.latest.simulateClose();
    expect(MockWebSocket.instances).toHaveLength(2);

    // After 2s (doubled backoff) the third socket appears
    vi.advanceTimersByTime(2_000);
    expect(MockWebSocket.instances).toHaveLength(3);

    client.close();
  });

  it("resets backoff delay to minimum after a successful reconnect", () => {
    vi.useFakeTimers();
    const client = createDashboardWs();

    // First connection opens + closes → backoff doubles to 2s
    MockWebSocket.latest.simulateOpen();
    MockWebSocket.latest.simulateClose();
    vi.advanceTimersByTime(1_000);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Second connection opens successfully → backoff resets
    MockWebSocket.latest.simulateOpen();

    // Drops again
    MockWebSocket.latest.simulateClose();

    // Should reconnect after 1s (reset delay), not 2s
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);

    client.close();
  });

  it("caps reconnect delay at 30 seconds", () => {
    vi.useFakeTimers();
    const client = createDashboardWs();

    // Keep dropping connections to exhaust the backoff ceiling
    // Delays: 1s → 2s → 4s → 8s → 16s → 30s (capped)
    const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const delay of expectedDelays) {
      MockWebSocket.latest.simulateClose();
      vi.advanceTimersByTime(delay - 1);
      const countBefore = MockWebSocket.instances.length;
      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances.length).toBe(countBefore + 1);
    }

    client.close();
  });

  it("ignores malformed JSON messages without throwing", () => {
    const client = createDashboardWs();
    MockWebSocket.latest.simulateOpen();

    const badMessage = () => {
      MockWebSocket.latest.onmessage?.({ data: "not json{{" } as MessageEvent);
    };
    expect(badMessage).not.toThrow();
    expect(client.pendingExecutions).toBe(0);
    client.close();
  });
});
