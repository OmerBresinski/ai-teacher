import { describe, expect, test } from "bun:test";
import { DEFAULT_MODEL_IDS } from "./create-ai";
import { costUsd, isPriced, PRICES } from "./prices";

describe("PRICES", () => {
  test("has a row for exactly the three default model ids", () => {
    expect(Object.keys(PRICES).sort()).toEqual(Object.values(DEFAULT_MODEL_IDS).sort());
    for (const price of Object.values(PRICES)) {
      expect(price.inputPerMTok).toBeGreaterThan(0);
      expect(price.outputPerMTok).toBeGreaterThan(price.inputPerMTok);
      expect(price.cachedInputPerMTok).toBeLessThan(price.inputPerMTok);
    }
  });
});

describe("costUsd", () => {
  test("a million uncached input tokens cost exactly the input list price", () => {
    const price = PRICES[DEFAULT_MODEL_IDS.standard];
    expect(costUsd(DEFAULT_MODEL_IDS.standard, { inputTokens: 1_000_000, outputTokens: 0 })).toBe(
      price?.inputPerMTok as number,
    );
  });

  test("bills cached input at the cached rate and output at the output rate", () => {
    const id = DEFAULT_MODEL_IDS.small;
    const price = PRICES[id];
    if (!price) throw new Error("small is unpriced");
    const cost = costUsd(id, { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 400 });
    const expected =
      (600 * price.inputPerMTok + 400 * price.cachedInputPerMTok + 500 * price.outputPerMTok) /
      1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
  });

  test("cached tokens never exceed the input total", () => {
    const id = DEFAULT_MODEL_IDS.small;
    const price = PRICES[id];
    if (!price) throw new Error("small is unpriced");
    expect(costUsd(id, { inputTokens: 10, outputTokens: 0, cachedInputTokens: 50 })).toBeCloseTo(
      (10 * price.cachedInputPerMTok) / 1_000_000,
      12,
    );
  });

  test("an unknown model id is unpriced: null, and isPriced says so", () => {
    expect(costUsd("made-up", { inputTokens: 1, outputTokens: 1 })).toBeNull();
    expect(isPriced("made-up")).toBe(false);
    expect(isPriced(DEFAULT_MODEL_IDS.frontier)).toBe(true);
  });

  test("a prototype property name is not a priced model", () => {
    for (const id of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(isPriced(id)).toBe(false);
      expect(costUsd(id, { inputTokens: 1, outputTokens: 1 })).toBeNull();
    }
  });

  test("zero usage costs zero, not null", () => {
    expect(costUsd(DEFAULT_MODEL_IDS.frontier, { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});
