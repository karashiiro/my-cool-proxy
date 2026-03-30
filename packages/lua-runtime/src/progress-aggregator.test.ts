import { describe, it, expect } from "vitest";
import { ProgressAggregator } from "./progress-aggregator.js";

describe("ProgressAggregator", () => {
  it("should emit aggregated progress from a single call", () => {
    const updates: Array<{
      progress: number;
      total?: number;
      message?: string;
    }> = [];

    const aggregator = new ProgressAggregator((progress, total, message) => {
      updates.push({ progress, total, message });
    });

    const callId = aggregator.register();
    aggregator.update(callId, { progress: 50, total: 100, message: "halfway" });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      progress: 50,
      total: 100,
      message: "halfway",
    });
  });

  it("should sum progress and total across multiple calls", () => {
    const updates: Array<{
      progress: number;
      total?: number;
      message?: string;
    }> = [];

    const aggregator = new ProgressAggregator((progress, total, message) => {
      updates.push({ progress, total, message });
    });

    const call1 = aggregator.register();
    const call2 = aggregator.register();

    aggregator.update(call1, { progress: 25, total: 100 });
    aggregator.update(call2, { progress: 50, total: 200 });

    // Last update should be the aggregate of both calls
    const last = updates[updates.length - 1];
    if (!last) throw new Error("Expected at least one update");
    expect(last.progress).toBe(75); // 25 + 50
    expect(last.total).toBe(300); // 100 + 200
  });

  it("should make total undefined if any call has no total", () => {
    const updates: Array<{
      progress: number;
      total?: number;
      message?: string;
    }> = [];

    const aggregator = new ProgressAggregator((progress, total, message) => {
      updates.push({ progress, total, message });
    });

    const call1 = aggregator.register();
    const call2 = aggregator.register();

    aggregator.update(call1, { progress: 50, total: 100 });
    aggregator.update(call2, { progress: 10 }); // no total

    const last = updates[updates.length - 1];
    if (!last) throw new Error("Expected at least one update");
    expect(last.progress).toBe(60); // 50 + 10
    expect(last.total).toBeUndefined(); // one call has no total
  });

  it("should forward the latest message", () => {
    const updates: Array<{
      progress: number;
      total?: number;
      message?: string;
    }> = [];

    const aggregator = new ProgressAggregator((progress, total, message) => {
      updates.push({ progress, total, message });
    });

    const call1 = aggregator.register();
    const call2 = aggregator.register();

    aggregator.update(call1, { progress: 10, total: 100, message: "from A" });
    aggregator.update(call2, { progress: 20, total: 100, message: "from B" });

    // Latest message should be from the most recent update
    const last = updates[updates.length - 1];
    if (!last) throw new Error("Expected at least one update");
    expect(last.message).toBe("from B");
  });

  it("should handle multiple updates to the same call", () => {
    const updates: Array<{
      progress: number;
      total?: number;
      message?: string;
    }> = [];

    const aggregator = new ProgressAggregator((progress, total, message) => {
      updates.push({ progress, total, message });
    });

    const callId = aggregator.register();

    aggregator.update(callId, { progress: 25, total: 100 });
    aggregator.update(callId, { progress: 50, total: 100 });
    aggregator.update(callId, { progress: 100, total: 100 });

    expect(updates).toHaveLength(3);
    expect(updates[2]).toEqual({
      progress: 100,
      total: 100,
      message: undefined,
    });
  });

  it("should not include registered-but-not-yet-updated calls in aggregation", () => {
    const updates: Array<{
      progress: number;
      total?: number;
      message?: string;
    }> = [];

    const aggregator = new ProgressAggregator((progress, total, message) => {
      updates.push({ progress, total, message });
    });

    const call1 = aggregator.register();
    aggregator.register(); // call2 registered but never updated

    aggregator.update(call1, { progress: 50, total: 100 });

    // Only call1 should be included — call2 hasn't reported yet
    const last = updates[updates.length - 1];
    if (!last) throw new Error("Expected at least one update");
    expect(last.progress).toBe(50);
    expect(last.total).toBe(100); // NOT undefined — call2 doesn't taint it
  });
});
