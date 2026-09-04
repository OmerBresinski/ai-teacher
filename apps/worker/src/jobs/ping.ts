import { defineJob, NonRetryableError } from "@tj/jobs";

const STEP_MS = 300;

/**
 * ADR 0012 demo job: emits `steps` progress events 300 ms apart, checks the abort signal between
 * steps, and throws `NonRetryableError` at `failAt` to exercise the failure path.
 */
export const pingJob = defineJob("ping", async ({ payload, signal, progress, logger }) => {
  const { steps, failAt } = payload;
  for (let i = 1; i <= steps; i++) {
    if (signal.aborted) return;
    await Bun.sleep(STEP_MS);
    if (signal.aborted) return;
    if (failAt !== undefined && i === failAt) {
      throw new NonRetryableError(`ping asked to fail at step ${i}/${steps}`);
    }
    await progress(Math.round((i / steps) * 100), `step ${i}/${steps}`);
  }
  logger.debug({ steps }, "ping done");
});
