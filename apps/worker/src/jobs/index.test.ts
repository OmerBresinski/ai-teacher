import { describe, expect, test } from "bun:test";
import { NonRetryableError } from "@tj/jobs";
import { registry } from "./index";

describe("registry placeholders (TEACH-311)", () => {
  // The handler ignores its context; TEACH-14 replaces it with the real job.
  for (const name of ["lesson.worksheet"] as const) {
    test(`${name} fails without retry until its handler lands`, async () => {
      const run = registry[name](undefined as never);
      await expect(run).rejects.toBeInstanceOf(NonRetryableError);
      await expect(run).rejects.toThrow(`${name} is not implemented (TEACH-311)`);
    });
  }
});
