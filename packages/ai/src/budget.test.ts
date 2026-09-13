import { describe, expect, test } from "bun:test";
import { createBudget } from "./budget";
import { DEFAULT_MODEL_IDS } from "./create-ai";
import { costUsd, PRICES } from "./prices";

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
    expect(budget.totals().costUsd).toBeCloseTo(price.longContext?.cachedInputPerMTok ?? 0, 12);
  });
});

describe("atomic reservations", () => {
  const estimate = { inputTokens: 1000, outputTokens: 100 };
  const reserve = (budget: ReturnType<typeof createBudget>, modelId: string = STANDARD) => {
    const result = budget.reserve(modelId, estimate);
    if (!("reservation" in result)) throw new Error("expected admission");
    return result.reservation;
  };

  test("one-call allowance admits one of four competitors, then releases only unused estimate", () => {
    const capUsd = costUsd(STANDARD, estimate) as number;
    const budget = createBudget({ capUsd, capTokens: 100_000 });
    const token = reserve(budget);
    for (let i = 0; i < 3; i++) expect(budget.reserve(STANDARD, estimate)).toEqual({ by: "usd" });
    expect(budget.totals()).toMatchObject({
      calls: 0,
      reserved: { calls: 1, ...estimate, costUsd: capUsd },
    });
    expect(budget.remaining().usd).toBe(0);
    expect(budget.settle(token, { inputTokens: 100, outputTokens: 10 })).toBe(true);
    expect(budget.totals()).not.toHaveProperty("reserved");
    expect(budget.totals().calls).toBe(1);
    expect(budget.remaining().usd).toBeCloseTo(capUsd * 0.9, 12);
    expect(budget.settle(token, estimate)).toBe(false);
    budget.markUncertain(token);
    expect(budget.totals().calls).toBe(1);
  });

  test("zero and seeded exhausted budgets deny admission", () => {
    expect(createBudget({ capUsd: 0, capTokens: 1000 }).reserve(STANDARD, estimate)).toEqual({
      by: "usd",
    });
    const budget = createBudget(
      { capUsd: 0.5, capTokens: 1000 },
      { spent: { calls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0.5 } },
    );
    expect(budget.reserve(STANDARD, estimate)).toEqual({ by: "usd" });
  });

  test("uncertain usage remains held, late complete usage settles once, foreign tokens cannot", () => {
    const budget = createBudget({ capUsd: 1, capTokens: 100_000 });
    const other = createBudget({ capUsd: 1, capTokens: 100_000 });
    const token = reserve(budget);
    const before = budget.remaining();
    budget.markUncertain(token);
    budget.markUncertain(token);
    expect(budget.remaining()).toEqual(before);
    expect(budget.totals()).toMatchObject({ calls: 0, uncertain: { calls: 1, ...estimate } });
    expect(other.settle(token, estimate)).toBe(false);
    expect(budget.settle(token, estimate)).toBe(true);
    expect(budget.settle(token, estimate)).toBe(false);
    expect(budget.totals()).not.toHaveProperty("uncertain");
    expect(budget.totals().calls).toBe(1);
  });

  test("unpriced reservations switch to token admission before dispatch and retain prior usage", () => {
    const budget = createBudget(
      { capUsd: 1, capTokens: 1200 },
      { spent: { calls: 1, inputTokens: 100, outputTokens: 0, costUsd: 0.2 } },
    );
    const token = reserve(budget, "unpriced");
    expect(budget.remaining()).toEqual({ usd: null, tokens: 0 });
    expect(budget.reserve(STANDARD, estimate)).toEqual({ by: "tokens" });
    expect(budget.totals().costUsd).toBe(0.2);
    budget.markUncertain(token);
    const resumed = createBudget({ capUsd: 1, capTokens: 1200 }, { spent: budget.totals() });
    expect(resumed.reserve(STANDARD, estimate)).toEqual({ by: "tokens" });
  });

  test("resume preserves exact confirmed USD and converts pending estimates to uncertainty", () => {
    const budget = createBudget({ capUsd: 1, capTokens: 100_000 });
    reserve(budget);
    budget.markUncertain(reserve(budget));
    const prior = { ...budget.totals(), costUsd: 0.07123456 };
    const resumed = createBudget({ capUsd: 1, capTokens: 100_000 }, { spent: prior });
    expect(resumed.totals().costUsd).toBe(prior.costUsd);
    expect(resumed.totals()).not.toHaveProperty("reserved");
    expect(resumed.totals().uncertain?.calls).toBe(2);
    expect(resumed.remaining().usd).toBeCloseTo(
      1 - prior.costUsd - 2 * (costUsd(STANDARD, estimate) as number),
      12,
    );
    expect(prior.reserved?.calls).toBe(1);
  });

  test("invalid usage never frees a reservation; actual overages are not clamped", () => {
    const budget = createBudget({ capUsd: 1, capTokens: 100_000 });
    const token = reserve(budget);
    expect(budget.settle(token, { inputTokens: Number.NaN, outputTokens: 1 })).toBe(false);
    expect(budget.totals().uncertain?.calls).toBe(1);
    expect(() => budget.reserve(STANDARD, { inputTokens: -1, outputTokens: 1 })).toThrow();
    expect(budget.settle(token, { inputTokens: 1_000_000, outputTokens: 0 })).toBe(true);
    expect(budget.exceeded()).toEqual({ by: "usd" });
    expect(budget.totals().inputTokens).toBe(1_000_000);
  });
});
