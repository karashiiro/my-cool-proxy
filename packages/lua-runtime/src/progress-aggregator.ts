/**
 * Aggregates progress from multiple concurrent upstream tool calls
 * into a single downstream progress stream.
 *
 * Strategy: sum progress values and sum total values across all active calls.
 * If ANY call has no total, the aggregate total is undefined.
 *
 * Calls are only included in aggregation after their first progress update
 * (via `update()`), so newly registered calls that haven't reported yet
 * don't taint the aggregate total with undefined.
 */
export class ProgressAggregator {
  private calls = new Map<
    number,
    { progress: number; total?: number; message?: string }
  >();
  private nextCallId = 0;

  constructor(
    private onProgress: (
      progress: number,
      total?: number,
      message?: string,
    ) => void,
  ) {}

  /**
   * Register a new tool call and return its unique call ID.
   * The call is not included in aggregation until the first `update()`.
   */
  register(): number {
    return this.nextCallId++;
  }

  /**
   * Update progress for a specific tool call and emit aggregated progress.
   */
  update(
    callId: number,
    progress: { progress: number; total?: number; message?: string },
  ): void {
    this.calls.set(callId, progress);
    this.emit(progress.message);
  }

  private emit(latestMessage?: string): void {
    let totalProgress = 0;
    let totalSum: number | undefined = 0;

    for (const entry of this.calls.values()) {
      totalProgress += entry.progress;
      if (totalSum !== undefined && entry.total !== undefined) {
        totalSum += entry.total;
      } else if (entry.total === undefined) {
        // If any call has no total, aggregate total is undefined
        totalSum = undefined;
      }
    }

    this.onProgress(totalProgress, totalSum, latestMessage);
  }
}
