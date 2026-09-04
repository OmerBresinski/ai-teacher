import { describe, expect, test } from "bun:test";
import { NonRetryableError } from "@tj/jobs";
import pino from "pino";
import { pingJob } from "./ping";

const logger = pino({ level: "silent" });
const ids = {
  jobId: "0192f7a0-0000-7000-8000-000000000001",
  workspaceId: "0192f7a0-0000-7000-8000-000000000002",
} as unknown as { jobId: never; workspaceId: never };

function ctx(
  payload: { message: string; steps: number; failAt?: number },
  ac = new AbortController(),
) {
  const calls: Array<[number | undefined, string | undefined]> = [];
  return {
    calls,
    ac,
    ctx: {
      ...ids,
      payload,
      signal: ac.signal,
      progress: async (percent?: number, message?: string) => {
        calls.push([percent, message]);
      },
      logger,
    },
  };
}

describe("ping job", () => {
  test("reports one progress per step with percent and 'step i/n'", async () => {
    const h = ctx({ message: "hi", steps: 2 });
    await pingJob(h.ctx);
    expect(h.calls).toEqual([
      [50, "step 1/2"],
      [100, "step 2/2"],
    ]);
  });

  test("throws NonRetryableError at failAt", async () => {
    const h = ctx({ message: "hi", steps: 3, failAt: 2 });
    await expect(pingJob(h.ctx)).rejects.toBeInstanceOf(NonRetryableError);
    expect(h.calls).toEqual([[33, "step 1/3"]]);
  });

  test("stops at the next step boundary once the signal is aborted", async () => {
    const h = ctx({ message: "hi", steps: 10 });
    const run = pingJob(h.ctx);
    await Bun.sleep(350);
    h.ac.abort("cancelled");
    await run;
    expect(h.calls.length).toBeLessThanOrEqual(2);
    expect(h.calls.length).toBeGreaterThanOrEqual(1);
  });
});
