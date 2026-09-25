import { describe, expect, test } from "bun:test";
import { DEFAULT_MODEL_IDS } from "./create-ai";
import { costUsd, isPriced, PRICES } from "./prices";

describe("PRICES", () => {
  test("has a row for exactly the three default model ids", () => {
    // Every default id has a row; gateway ids (the model bench) may have rows too.
    for (const id of Object.values(DEFAULT_MODEL_IDS)) expect(Object.keys(PRICES)).toContain(id);
    for (const id of Object.keys(PRICES))
      expect(id.includes("/") || Object.values(DEFAULT_MODEL_IDS).includes(id as never)).toBe(true);
    for (const price of Object.values(PRICES)) {
      expect(price.inputPerMTok).toBeGreaterThan(0);
      expect(price.outputPerMTok).toBeGreaterThan(price.inputPerMTok);
      expect(price.cachedInputPerMTok).toBeLessThan(price.inputPerMTok);
    }
  });

  test("every `openai/` id the lab routes is priced, so a budget is a dollar cap on the direct route (ADR 0031)", () => {
    for (const id of [
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-sol",
      "openai/gpt-6-luna",
      "openai/gpt-6-sol",
    ])
      expect(isPriced(id)).toBe(true);
    // Gateway-only (404 direct) and the lab's priority tier are deliberately absent.
    expect(isPriced("openai/gpt-6-luna-fast")).toBe(false);
    expect(isPriced("openai/gpt-5.6-luna@priority")).toBe(false);
  });
});

describe("costUsd", () => {
  test("a million input tokens use the long-context price", () => {
    const price = PRICES[DEFAULT_MODEL_IDS.standard];
    expect(costUsd(DEFAULT_MODEL_IDS.standard, { inputTokens: 1_000_000, outputTokens: 0 })).toBe(
      price?.longContext?.inputPerMTok as number,
    );
  });

  test("the long-context threshold applies to the whole call, including output and cache writes", () => {
    const model = DEFAULT_MODEL_IDS.standard;
    expect(costUsd(model, { inputTokens: 272_000, outputTokens: 1000 })).toBeCloseTo(
      (272_000 * 2.2 + 1000 * 13.2) / 1_000_000,
      12,
    );
    expect(costUsd(model, { inputTokens: 272_001, outputTokens: 1000 })).toBeCloseTo(
      (272_001 * 4.4 + 1000 * 19.8) / 1_000_000,
      12,
    );
    expect(
      costUsd(model, { inputTokens: 1000, outputTokens: 0, cacheWriteInputTokens: 1000 }),
    ).toBe(0.00275);
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
