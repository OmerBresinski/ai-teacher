import { describe, expect, test } from "bun:test";
import { createBudget } from "./budget";
import { DEFAULT_MODEL_IDS } from "./create-ai";
import { PRICES } from "./prices";

const STANDARD = DEFAULT_MODEL_IDS.standard;
const price = PRICES[STANDARD];
if (!price) throw new Error("standard is unpriced");

/** Input tokens that cost exactly `usd` on the standard model. */
const tokensFor = (usd: number) => Math.round((usd / price.inputPerMTok) * 1_000_000);

describe("createBudget", () => {
  test("a USD cap: allowed at 0.49, exceeded at 0.51", () => {
    const budget = createBudget({ capUsd: 0.5, capTokens: 300_000 });
    expect(budget.exceeded()).toBeNull();
    budget.charge(STANDARD, { inputTokens: tokensFor(0.49), outputTokens: 0 });
    expect(budget.exceeded()).toBeNull();
    expect(budget.remaining().usd).toBeCloseTo(0.01, 4);
    budget.charge(STANDARD, { inputTokens: tokensFor(0.02), outputTokens: 0 });
    expect(budget.exceeded()).toEqual({ by: "usd" });
    expect(budget.remaining().usd).toBe(0);
    expect(budget.totals()).toMatchObject({
      calls: 2,
      inputTokens: tokensFor(0.49) + tokensFor(0.02),
      outputTokens: 0,
    });
    expect(budget.totals().costUsd).toBeCloseTo(0.51, 4);
  });

  test("reaching the cap leaves no allowance for another call", () => {
    // The cap is set to exactly what 200 000 standard input tokens cost at the list price.
    const capUsd = (200_000 / 1_000_000) * price.inputPerMTok;
    const budget = createBudget({ capUsd, capTokens: 300_000 });
    budget.charge(STANDARD, { inputTokens: 200_000, outputTokens: 0 });
    expect(budget.totals().costUsd).toBeCloseTo(capUsd, 10);
    expect(budget.exceeded()).toEqual({ by: "usd" });
  });

  test("an unpriced model id switches the cap to tokens for the rest of the budget", () => {
    const budget = createBudget({ capUsd: 0.5, capTokens: 1000 });
    budget.charge(STANDARD, { inputTokens: 100, outputTokens: 100 });
    expect(budget.totals().costUsd).not.toBeNull();

    budget.charge("made-up", { inputTokens: 300, outputTokens: 100 });
    expect(budget.remaining().usd).toBeNull();
    expect(budget.totals().costUsd).toBeNull();
    expect(budget.exceeded()).toBeNull();
    expect(budget.remaining().tokens).toBe(1000 - 600);

    // Back on a priced model: the cost is still unknowable, so the token cap stays in force.
    budget.charge(STANDARD, { inputTokens: 400, outputTokens: 100 });
    expect(budget.totals().costUsd).toBeNull();
    expect(budget.exceeded()).toEqual({ by: "tokens" });
    expect(budget.remaining().tokens).toBe(0);
    expect(budget.totals()).toMatchObject({ calls: 3, inputTokens: 800, outputTokens: 300 });
  });

  test("the caller's `priced` predicate decides what counts as priced", () => {
    const budget = createBudget({ capUsd: 0.5, capTokens: 10, priced: () => false });
    budget.charge(STANDARD, { inputTokens: 6, outputTokens: 5 });
    expect(budget.totals().costUsd).toBeNull();
    expect(budget.exceeded()).toEqual({ by: "tokens" });
  });

  test("charge never throws and a fresh budget has zero totals", () => {
    const budget = createBudget({ capUsd: 0, capTokens: 0 });
    expect(budget.totals()).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(budget.exceeded()).toEqual({ by: "usd" });
    expect(() => budget.charge("made-up", { inputTokens: 1, outputTokens: 0 })).not.toThrow();
    expect(budget.exceeded()).toEqual({ by: "tokens" });
  });

  test("resume seeds exact aggregates and adds each new call without repricing prior USD", () => {
    const spent = { calls: 15, inputTokens: 20_000, outputTokens: 3000, costUsd: 0.07 };
    const budget = createBudget({ capUsd: 0.5, capTokens: 300_000 }, { spent });
    expect(budget.totals()).toEqual(spent);
    for (let i = 0; i < 5; i++) budget.charge(STANDARD, { inputTokens: 1000, outputTokens: 0 });
    expect(budget.totals()).toEqual({
      calls: 20,
      inputTokens: 25_000,
      outputTokens: 3000,
      costUsd: expect.closeTo(0.07 + (5 * price.inputPerMTok) / 1000, 10),
    });
    expect(spent.calls).toBe(15);
    expect(spent.costUsd).toBe(0.07);
  });

  test.each([0.5, 0.6])("prior USD %s at or above the cap blocks the first new call", (costUsd) => {
    const budget = createBudget(
      { capUsd: 0.5, capTokens: 300_000 },
      { spent: { calls: 15, inputTokens: 20_000, outputTokens: 3000, costUsd } },
    );
    expect(budget.exceeded()).toEqual({ by: "usd" });
    expect(budget.remaining().usd).toBe(0);
  });

  test("null prior cost preserves token fallback, including exact exhaustion", () => {
    const budget = createBudget(
      { capUsd: 0.5, capTokens: 1000 },
      { spent: { calls: 2, inputTokens: 700, outputTokens: 200, costUsd: null } },
    );
    expect(budget.remaining()).toEqual({ usd: null, tokens: 100 });
    budget.charge(STANDARD, { inputTokens: 100, outputTokens: 0 });
    expect(budget.exceeded()).toEqual({ by: "tokens" });
    expect(budget.totals()).toEqual({
      calls: 3,
      inputTokens: 800,
      outputTokens: 200,
      costUsd: null,
    });
    const exhausted = createBudget({ capUsd: 0.5, capTokens: 1000 }, { spent: budget.totals() });
    expect(exhausted.exceeded()).toEqual({ by: "tokens" });
  });

  test("cached input is billed at the cached rate", () => {
    const budget = createBudget({ capUsd: 1, capTokens: 1_000_000 });
    budget.charge(STANDARD, {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    });
    expect(budget.totals().costUsd).toBeCloseTo(price.cachedInputPerMTok, 12);
  });
});
