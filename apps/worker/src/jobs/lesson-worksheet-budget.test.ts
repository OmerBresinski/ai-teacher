import { describe, expect, test } from "bun:test";
import { createBudget } from "@tj/ai";
import { sheetAttemptSpend } from "./lesson-worksheet";

/*
 * R4 review (12 Nov), worksheets minor 5: the $0.10 per-sheet cap held per attempt, so a retry
 * after a billed call could spend it twice. What an attempt spent now seeds the retry.
 */
describe("one budget per sheet request", () => {
  const spend = (costUsd: number) => ({
    calls: 1,
    inputTokens: 1000,
    outputTokens: 500,
    costUsd,
  });
  const fakeBudget = (costUsd: number) =>
    createBudget({ capUsd: 0.1, capTokens: 1e9 }, { spent: spend(costUsd) });

  test("a retry starts from what the failed attempt spent, and the cap holds across both", () => {
    sheetAttemptSpend.keep("job-a", fakeBudget(0.08));
    const retry = createBudget({ capUsd: 0.1, capTokens: 1e9 }, sheetAttemptSpend.seed("job-a"));
    expect(retry.totals().costUsd).toBeCloseTo(0.08);
    expect(retry.exceeded()).toBeNull();
    sheetAttemptSpend.keep("job-a", fakeBudget(0.11));
    const over = createBudget({ capUsd: 0.1, capTokens: 1e9 }, sheetAttemptSpend.seed("job-a"));
    expect(over.exceeded()).toEqual({ by: "usd" });
  });

  test("the last attempt clears it; another request starts fresh", () => {
    sheetAttemptSpend.keep("job-b", fakeBudget(0.05));
    sheetAttemptSpend.clear("job-b");
    expect(sheetAttemptSpend.seed("job-b")).toEqual({});
    expect(sheetAttemptSpend.seed("job-other")).toEqual({});
  });
});
