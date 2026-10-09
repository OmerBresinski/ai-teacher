import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { createBudget } from "./budget";
import { estimatePreparedCall, type PreparedCall } from "./budget-estimate";
import { withGenerationBudget } from "./budget-middleware";
import { costUsd } from "./prices";

/*
 * Register proof layout-05 (S7, 10 Oct 2026; d52 T1 y1, cost.json: usage.uncertain {calls: 10,
 * inputTokens: 1650985, costUsd: 0.2146} against completed calls of $0.0601, then
 * BudgetReservationError at budget-middleware.ts:140). A generate call that ends with no usage
 * (finishReason error, null usage) keeps its whole pre-call estimate booked (line 156), so ten
 * failed image picks starved the lesson. Fixed: such a call settles at its prompt's text input
 * (`failedCallFloor`); the marked assertion is inverted.
 */
const id = "openai/gpt-6-luna";
const pick: PreparedCall = {
  maxOutputTokens: 1650,
  prompt: [
    {
      role: "user",
      // an image with no readable header is estimated at the full image bound (as the picks were)
      content: [
        { type: "text", text: "Which photo shows a calf?" },
        { type: "file", mediaType: "image/png", data: { type: "data", data: new Uint8Array() } },
      ],
    },
  ],
};
const writer: PreparedCall = {
  maxOutputTokens: 16000,
  prompt: [{ role: "user", content: [{ type: "text", text: "x".repeat(40_000) }] }],
};

describe("REGISTER layout-05: errored photo picks keep budget booked; the lesson fails (d52 T1 y1)", () => {
  test("FIXED layout-05: after ten null-usage picks a writer-sized call is still admitted", async () => {
    const img = costUsd(id, estimatePreparedCall(id, pick) as never) as number;
    const big = costUsd(id, estimatePreparedCall(id, writer) as never) as number;
    expect(img).toBeGreaterThan(0);
    // Room for the writer call alone, but not for the writer plus ten held pick estimates.
    const mk = (budget: ReturnType<typeof createBudget>) =>
      withGenerationBudget(
        new MockLanguageModelV4({
          doGenerate: async () =>
            ({
              warnings: [],
              content: [],
              finishReason: { unified: "error", raw: "provider error" },
              usage: {
                inputTokens: {
                  total: undefined,
                  noCache: undefined,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: undefined, text: undefined, reasoning: undefined },
              },
            }) as never,
        }),
        id,
        budget,
      );
    // Control: with nothing held, the same cap admits the writer call.
    const fresh = mk(createBudget({ capUsd: big + 5 * img, capTokens: 100_000_000 }));
    await expect(fresh.doGenerate(writer as never)).resolves.toBeDefined();
    const budget = createBudget({ capUsd: big + 5 * img, capTokens: 100_000_000 });
    const model = mk(budget);
    for (let k = 0; k < 10; k++)
      await Promise.resolve(model.doGenerate(pick as never)).catch(() => undefined);
    // Inverted by the fix: the picks settle at their text input, so the writer call is admitted.
    const text = new TextEncoder().encode("Which photo shows a calf?").byteLength;
    expect(budget.totals()).toMatchObject({ calls: 10, inputTokens: 10 * text, outputTokens: 0 });
    expect(budget.totals().uncertain).toBeUndefined();
    await expect(model.doGenerate(writer as never)).resolves.toBeDefined();
    // Without the fix the same call is refused with BudgetReservationError.
    expect(budget.lastRefusal()).toBeNull();
  });
});
