import { defineJob, NonRetryableError } from "@tj/jobs";

const STEP_MS = 300;

/** Waits `ms`, or less: an abort wakes it at once, so a cancel never waits out a step. */
function nap(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", wake);
      resolve();
    };
    const timer = setTimeout(wake, ms);
    signal.addEventListener("abort", wake, { once: true });
  });
}

/**
 * ADR 0012 demo job: emits `steps` progress events 300 ms apart, stops as soon as the abort signal
 * fires (mid-step too), and throws `NonRetryableError` at `failAt` to exercise the failure path.
 */
export const pingJob = defineJob("ping", async ({ payload, signal, progress, logger }) => {
  const { steps, failAt } = payload;
  for (let i = 1; i <= steps; i++) {
    if (signal.aborted) return;
    await nap(STEP_MS, signal);
    if (signal.aborted) return;
    if (failAt !== undefined && i === failAt) {
      throw new NonRetryableError(`ping asked to fail at step ${i}/${steps}`);
    }
    await progress(Math.round((i / steps) * 100), `step ${i}/${steps}`);
  }
  logger.debug({ steps }, "ping done");
});
