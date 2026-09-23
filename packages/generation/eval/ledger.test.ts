import { describe, expect, test } from "bun:test";
import { PRICES } from "@tj/ai";
import { callUsageOf, createLedger, ledgerStageOf, tokenUsageOf } from "./ledger";
import { mapPool } from "./pool";

describe("ledger", () => {
  test("a call's stage comes from its prompt version first, its pipeline stage second", () => {
    expect(ledgerStageOf({ stage: "plan", promptVersion: "plan-objectives.v6" })).toBe(
      "objectives",
    );
    expect(ledgerStageOf({ stage: "plan", promptVersion: "plan-facts-objective.v4" })).toBe(
      "facts",
    );
    expect(ledgerStageOf({ stage: "plan", promptVersion: "plan-facts.v10" })).toBe("facts");
    expect(ledgerStageOf({ stage: "plan", promptVersion: "plan-skeleton.v18" })).toBe("facts");
    expect(ledgerStageOf({ stage: "plan", promptVersion: "verify-facts.v1" })).toBe("verify");
    expect(ledgerStageOf({ stage: "generate", promptVersion: "generate-slide.v19" })).toBe(
      "generate",
    );
    expect(ledgerStageOf({ stage: "illustrate", promptVersion: "pick-or-requery-photo.v6" })).toBe(
      "illustrate",
    );
    expect(ledgerStageOf({ stage: "evaluate", promptVersion: "evaluate.v6" })).toBe("evaluate");
    expect(ledgerStageOf({ stage: "repair", promptVersion: "repair-fact.v2" })).toBe("repair");
    expect(ledgerStageOf({ stage: "repair" })).toBe("repair");
    expect(ledgerStageOf({ stage: "check-input", promptVersion: "check-input.v3" })).toBe("other");
    expect(ledgerStageOf({})).toBe("other");
  });

  test("rows aggregate per stage and model at list price; the judge stays out of the lesson total", () => {
    const model = "openai/gpt-5.6-luna";
    const price = PRICES[model];
    if (!price) throw new Error("price row");
    const ledger = createLedger();
    ledger.record({ stage: "facts", model, usage: { inputTokens: 1000, outputTokens: 500 } });
    ledger.record({
      stage: "facts",
      model,
      usage: { inputTokens: 1000, outputTokens: 500, cachedInputTokens: 400 },
    });
    ledger.record({ stage: "objectives", model, usage: { inputTokens: 100, outputTokens: 50 } });
    ledger.record({ stage: "judge", model, usage: { inputTokens: 10, outputTokens: 5 } });
    const rows = ledger.rows();
    expect(rows.map((r) => [r.stage, r.calls])).toEqual([
      ["objectives", 1],
      ["facts", 2],
      ["judge", 1],
    ]);
    const facts = rows[1];
    expect(facts?.inputTokens).toBe(2000);
    expect(facts?.outputTokens).toBe(1000);
    expect(facts?.cachedInputTokens).toBe(400);
    const expected =
      (1600 * price.inputPerMTok + 400 * price.cachedInputPerMTok + 1000 * price.outputPerMTok) /
      1_000_000;
    expect(facts?.usd).toBeCloseTo(expected, 10);
    expect(ledger.lessonTotal().calls).toBe(3);
    expect(ledger.allTotal().calls).toBe(4);
    expect(ledger.markdown()).toContain("| **lesson total** | | 3 |");
    expect(ledger.markdown()).toContain("| with judge | | 4 |");
  });

  test("an unpriced model id makes its row and the total unpriced", () => {
    const ledger = createLedger();
    ledger.record({
      stage: "generate",
      model: "nobody/no-such-model",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    ledger.record({
      stage: "generate",
      model: "openai/gpt-5.6-luna",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    expect(ledger.rows().map((r) => r.usd === null)).toEqual([true, false]);
    expect(ledger.lessonTotal().usd).toBeNull();
    expect(ledger.markdown()).toContain("unpriced");
  });

  test("usage conversions keep totals and cached reads; missing totals are null", () => {
    expect(
      tokenUsageOf({ inputTokens: { total: 10, cacheRead: 4 }, outputTokens: { total: 3 } }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 3,
      cachedInputTokens: 4,
    });
    expect(
      tokenUsageOf({ inputTokens: { total: undefined }, outputTokens: { total: 3 } }),
    ).toBeNull();
    expect(callUsageOf({ inputTokens: 5, outputTokens: 2 })).toEqual({
      inputTokens: 5,
      outputTokens: 2,
      cachedInputTokens: 0,
    });
    expect(callUsageOf({ inputTokens: undefined, outputTokens: 2 })).toBeNull();
  });
});

describe("mapPool", () => {
  test("at most `limit` tasks run at once and results keep input order", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapPool([5, 1, 4, 2, 3, 6, 0], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 0]);
    expect(peak).toBe(3);
  });

  test("an empty list resolves to an empty list", async () => {
    expect(await mapPool([], 6, async () => 1)).toEqual([]);
  });
});
