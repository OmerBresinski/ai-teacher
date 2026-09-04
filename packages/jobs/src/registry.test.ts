import { describe, expect, test } from "bun:test";
import { JobName } from "@tj/domain";
import { defineJob, type JobRegistry, NonRetryableError } from "./types";

/**
 * Type-level test: `JobRegistry` is a mapped type over `JobName`, so a registry missing a handler
 * does not compile. `tsc --noEmit` (the `typecheck` script) is what enforces the
 * `@ts-expect-error` lines below; at runtime this file only checks the helpers.
 */
describe("JobRegistry", () => {
  test("every JobName needs a handler", () => {
    const ok: JobRegistry = {
      ping: defineJob("ping", async ({ payload }) => {
        // payload is typed as PingPayload
        payload.message.toUpperCase();
        payload.steps.toFixed();
      }),
    };
    // @ts-expect-error missing `ping`
    const missing: JobRegistry = {};
    // @ts-expect-error unknown job name
    const extra: JobRegistry = { ...ok, nope: async () => {} };
    expect(Object.keys(ok)).toEqual(Object.values(JobName));
    expect(missing).toBeDefined();
    expect(extra).toBeDefined();
  });

  test("defineJob returns the handler unchanged", () => {
    const handler = async () => {};
    expect(defineJob("ping", handler)).toBe(handler);
  });

  test("NonRetryableError is an Error with its own name", () => {
    const err = new NonRetryableError("nope");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("NonRetryableError");
    expect(err.message).toBe("nope");
  });
});
