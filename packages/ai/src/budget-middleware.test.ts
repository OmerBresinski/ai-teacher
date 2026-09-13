import { describe, expect, test } from "bun:test";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createBudget } from "./budget";
import { estimatePreparedCall, MAX_IMAGE_INPUT_TOKENS, type PreparedCall } from "./budget-estimate";
import { BudgetReservationError, withGenerationBudget } from "./budget-middleware";
import { DEFAULT_MODEL_IDS } from "./create-ai";
import { costUsd } from "./prices";

const id = DEFAULT_MODEL_IDS.standard;
const params: PreparedCall = {
  maxOutputTokens: 100,
  prompt: [
    { role: "system", content: "system" },
    { role: "user", content: [{ type: "text", text: "input" }] },
  ],
};
const reply = () => ({
  warnings: [],
  content: [{ type: "text" as const, text: "ok" }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: {
    inputTokens: { total: 100, noCache: 60, cacheRead: 30, cacheWrite: 10 },
    outputTokens: { total: 10, text: 5, reasoning: 5 },
  },
});

describe("provider admission boundary", () => {
  test("four concurrent calls compete for one allowance: one dispatch and three refusals", async () => {
    const estimate = estimatePreparedCall(id, params);
    if (!estimate) throw new Error("fixture must be estimable");
    const budget = createBudget({ capUsd: costUsd(id, estimate) as number, capTokens: 100_000 });
    let dispatched = 0;
    const gate = Promise.withResolvers<ReturnType<typeof reply>>();
    const model = withGenerationBudget(
      new MockLanguageModelV4({
        doGenerate: async () => {
          dispatched++;
          return gate.promise;
        },
      }),
      id,
      budget,
    );
    const first = model.doGenerate(params);
    try {
      const others = await Promise.allSettled(
        Array.from({ length: 3 }, () => model.doGenerate(params)),
      );
      expect(dispatched).toBe(1);
      for (const result of others) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected")
          expect(result.reason).toBeInstanceOf(BudgetReservationError);
      }
      expect(budget.totals().reserved?.calls).toBe(1);
    } finally {
      gate.resolve(reply());
    }
    await first;
    expect(budget.totals()).toEqual({
      calls: 1,
      inputTokens: 100,
      outputTokens: 10,
      costUsd: costUsd(id, {
        inputTokens: 100,
        outputTokens: 10,
        cachedInputTokens: 30,
        cacheWriteInputTokens: 10,
      }),
    });
  });

  test("missing provider usage stays uncertain instead of becoming a zero-cost success", async () => {
    const budget = createBudget({ capUsd: 1, capTokens: 100_000 });
    const value = reply();
    const model = withGenerationBudget(
      new MockLanguageModelV4({
        doGenerate: async () => ({
          ...value,
          usage: { ...value.usage, inputTokens: { ...value.usage.inputTokens, total: undefined } },
        }),
      }),
      id,
      budget,
    );
    const result = await generateText({ model, prompt: "hi", maxOutputTokens: 100, maxRetries: 0 });
    expect(result.text).toBe("ok");
    expect(result.usage.inputTokens).toBeUndefined();
    expect(budget.totals()).toMatchObject({ calls: 0, uncertain: { calls: 1 } });
    expect(budget.remaining().usd).toBeLessThan(1);
  });

  test("an aborted attempt retains its reservation until late complete usage settles it", async () => {
    const budget = createBudget({ capUsd: 1, capTokens: 100_000 });
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<ReturnType<typeof reply>>();
    const abort = new AbortController();
    const model = withGenerationBudget(
      new MockLanguageModelV4({
        doGenerate: async () => {
          started.resolve();
          return gate.promise;
        },
      }),
      id,
      budget,
    );
    const pending = model.doGenerate({ ...params, abortSignal: abort.signal });
    await started.promise;
    const held = budget.remaining();
    abort.abort();
    expect(budget.remaining()).toEqual(held);
    expect(budget.totals().uncertain?.calls).toBe(1);
    gate.resolve(reply());
    await pending;
    expect(budget.totals().calls).toBe(1);
    expect(budget.totals()).not.toHaveProperty("uncertain");
  });
});

describe("prepared request estimates", () => {
  test("includes UTF-8 system/user bytes, the response schema and maximum output", () => {
    const base = estimatePreparedCall(id, params);
    const bigger = estimatePreparedCall(id, {
      ...params,
      prompt: [...params.prompt, { role: "system", content: "界".repeat(100) }],
      responseFormat: {
        type: "json",
        schema: { type: "object", description: "schema".repeat(100) },
      },
    });
    expect(bigger?.inputTokens).toBeGreaterThan((base?.inputTokens ?? 0) + 900);
    expect(bigger?.outputTokens).toBe(100);
    expect(bigger?.cacheWriteInputTokens).toBe(bigger?.inputTokens);
    expect(estimatePreparedCall(id, { ...params, maxOutputTokens: undefined })).toBeNull();
  });

  test("uses image dimensions, with a full bound for missing headers and refusal for unknown models", () => {
    const png = new Uint8Array(32);
    png.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    const view = new DataView(png.buffer);
    view.setUint32(16, 1024);
    view.setUint32(20, 1024);
    const withImage = (data: Uint8Array): PreparedCall => ({
      ...params,
      prompt: [
        {
          role: "user",
          content: [{ type: "file", mediaType: "image/png", data: { type: "data", data } }],
        },
      ],
    });
    const known = estimatePreparedCall(id, withImage(png));
    const unknown = estimatePreparedCall(id, withImage(new Uint8Array()));
    expect((unknown?.inputTokens ?? 0) - (known?.inputTokens ?? 0)).toBe(
      MAX_IMAGE_INPUT_TOKENS - 1230,
    );
    expect(estimatePreparedCall("unknown-model", withImage(png))).toBeNull();
    expect(estimatePreparedCall("unknown-model", params)).not.toBeNull();
  });
});
