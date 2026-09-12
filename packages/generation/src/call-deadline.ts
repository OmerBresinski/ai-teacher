import { throwIfAborted } from "./types";

/** Content-free: a provider's raw error may carry its request or response. */
export class CallTimeout extends Error {
  override readonly name = "CallTimeout";
}

/**
 * Bound one attempt, including a provider that never settles after abort. The same signal aborts
 * the actual request; a late response cannot reach the caller's budget charge or persistence.
 */
export async function withCallDeadline<T>(
  signal: AbortSignal,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  throwIfAborted(signal);
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(combined.reason);
    combined.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const result = await Promise.race([run(combined), aborted]);
    throwIfAborted(signal);
    if (timeout.aborted) throw new CallTimeout();
    return result;
  } catch (error) {
    // User cancellation/shutdown wins even if the deadline expired in the same turn.
    throwIfAborted(signal);
    if (timeout.aborted) throw new CallTimeout();
    throw error;
  } finally {
    combined.removeEventListener("abort", onAbort);
  }
}
