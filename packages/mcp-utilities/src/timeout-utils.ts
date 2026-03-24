/**
 * Error thrown when a promise does not settle within the given deadline.
 *
 * Carries structured `label` and `ms` properties so catch blocks can
 * distinguish timeout failures from other errors.
 */
export class TimeoutError extends Error {
  readonly label: string;
  readonly ms: number;

  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
    this.label = label;
    this.ms = ms;
  }
}

/**
 * Wraps a promise with a bounded deadline using `Promise.race()`.
 *
 * If the promise does not settle within `ms` milliseconds, the returned
 * promise rejects with a {@link TimeoutError}. The timer is cleared when
 * the promise settles before the deadline, preventing orphaned timers.
 *
 * @param promise - The promise to wrap
 * @param ms - Maximum time to wait in milliseconds
 * @param label - Descriptive label included in the TimeoutError for diagnostics
 * @returns The resolved value of the original promise
 * @throws {TimeoutError} If the promise does not settle within `ms`
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(label, ms));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}
