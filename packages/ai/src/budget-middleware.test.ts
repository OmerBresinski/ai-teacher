import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { generateText, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import pino from "pino";
import { createBudget } from "./budget";
import { estimatePreparedCall, MAX_IMAGE_INPUT_TOKENS, type PreparedCall } from "./budget-estimate";
import { BudgetReservationError, withGenerationBudget } from "./budget-middleware";
import { costUsd } from "./prices";
import { createFakeAi } from "./testing";

const id = "us.openai.gpt-5.6-terra";
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
    // The default (GPT-6 Luna, OpenAI direct) is estimable with an image, so the judge can run.
    expect(estimatePreparedCall("openai/gpt-6-luna", withImage(png))?.inputTokens).toBe(
      known?.inputTokens,
    );
    expect(estimatePreparedCall("unknown-model", params)).not.toBeNull();
  });

  test("the bare id the direct OpenAI provider reports takes images like its `openai/` id", () => {
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    new DataView(png.buffer).setUint32(16, 64);
    new DataView(png.buffer).setUint32(20, 64);
    const withImage: PreparedCall = {
      ...params,
      prompt: [
        {
          role: "user",
          content: [{ type: "file", mediaType: "image/png", data: { type: "data", data: png } }],
        },
      ],
    };
    for (const bare of [
      "gpt-6-luna",
      "gpt-6.1-sol",
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
    ]) {
      const estimate = estimatePreparedCall(bare, withImage);
      expect(estimate).not.toBeNull();
      expect(estimate).toEqual(estimatePreparedCall(`openai/${bare}`, withImage));
    }
    // Only the missing prefix is forgiven: other ids and other providers stay refused.
    for (const refused of ["gpt-6-sol", "gpt-4o", "google/gpt-6-luna", "openai.gpt-6-luna"])
      expect(estimatePreparedCall(refused, withImage)).toBeNull();
  });
});

/** The lab writer's model: streamed, priced, text only. */
const sol = "openai/gpt-6.1-sol";
const usage = {
  inputTokens: { total: 10_000, noCache: 8_000, cacheRead: 2_000, cacheWrite: 0 },
  outputTokens: { total: 2_300, text: 2_000, reasoning: 300 },
};
const finish = (u: unknown = usage) =>
  ({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: u }) as never;

/** A stubbed provider stream: the test pushes parts, finishes or fails it when it chooses. */
function stubStream() {
  let controller!: ReadableStreamDefaultController<unknown>;
  let cancelled = false;
  let dispatched = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      dispatched++;
      return {
        stream: new ReadableStream({
          start(c) {
            controller = c as never;
            c.enqueue({ type: "text-start", id: "t" });
            c.enqueue({ type: "text-delta", id: "t", delta: "slide" });
          },
          cancel() {
            cancelled = true;
          },
        }) as never,
      };
    },
  });
  return {
    model,
    push: (part: unknown) => controller.enqueue(part),
    close: () => controller.close(),
    fail: (error: Error) => controller.error(error),
    dispatched: () => dispatched,
    cancelled: () => cancelled,
  };
}

async function drain(stream: ReadableStream<unknown>) {
  const parts: unknown[] = [];
  const reader = stream.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) return parts;
    parts.push(next.value);
  }
}

describe("streamed calls (the lesson writer on gpt-6.1-sol)", () => {
  test("reserve before dispatch, hold while open, settle from the finish part's usage", async () => {
    const budget = createBudget({ capUsd: 1, capTokens: 1_000_000 });
    const stub = stubStream();
    const model = withGenerationBudget(stub.model, sol, budget);
    const { stream } = await model.doStream(params);
    expect(budget.totals().reserved?.calls).toBe(1);
    expect(budget.totals().calls).toBe(0);
    stub.push(finish());
    stub.close();
    const parts = await drain(stream);
    expect(parts.map((p) => (p as { type: string }).type)).toEqual([
      "text-start",
      "text-delta",
      "finish",
    ]);
    expect(budget.totals()).toEqual({
      calls: 1,
      inputTokens: 10_000,
      outputTokens: 2_300,
      costUsd: costUsd(sol, {
        inputTokens: 10_000,
        outputTokens: 2_300,
        cachedInputTokens: 2_000,
        cacheWriteInputTokens: 0,
      }),
    });
  });

  test("the cap holds mid-stream: an open stream's reservation refuses the next call, streamed or not", async () => {
    const estimate = estimatePreparedCall(sol, params);
    if (!estimate) throw new Error("fixture must be estimable");
    const budget = createBudget({ capUsd: costUsd(sol, estimate) as number, capTokens: 1_000_000 });
    const stub = stubStream();
    const model = withGenerationBudget(stub.model, sol, budget);
    const { stream } = await model.doStream(params);
    await expect(model.doStream(params)).rejects.toBeInstanceOf(BudgetReservationError);
    await expect(model.doGenerate(params)).rejects.toBeInstanceOf(BudgetReservationError);
    expect(stub.dispatched()).toBe(1);
    stub.push(finish());
    stub.close();
    await drain(stream);
    // Settled at the actual (smaller) usage, so the remainder admits nothing over the cap.
    expect(budget.totals().reserved).toBeUndefined();
    expect(budget.totals().calls).toBe(1);
  });

  test("an abort mid-stream leaves the reservation uncertain, and a late finish still settles it once", async () => {
    const budget = createBudget({ capUsd: 1, capTokens: 1_000_000 });
    const stub = stubStream();
    const model = withGenerationBudget(stub.model, sol, budget);
    const abort = new AbortController();
    const { stream } = await model.doStream({ ...params, abortSignal: abort.signal });
    abort.abort();
    expect(budget.totals().uncertain?.calls).toBe(1);
    stub.push(finish());
    stub.close();
    await drain(stream);
    expect(budget.totals().uncertain).toBeUndefined();
    expect(budget.totals().calls).toBe(1);
  });

  test("an already-aborted signal dispatches nothing and reserves nothing", async () => {
    const budget = createBudget({ capUsd: 1, capTokens: 1_000_000 });
    const stub = stubStream();
    const model = withGenerationBudget(stub.model, sol, budget);
    await expect(model.doStream({ ...params, abortSignal: AbortSignal.abort() })).rejects.toThrow();
    expect(stub.dispatched()).toBe(0);
    expect(budget.totals()).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
  });

  test("a stream cancelled by its reader, one that errors and one that ends without usage stay uncertain", async () => {
    const budget = createBudget({ capUsd: 1, capTokens: 1_000_000 });

    const cancelled = stubStream();
    const a = await withGenerationBudget(cancelled.model, sol, budget).doStream(params);
    await a.stream.getReader().cancel("teacher left");
    expect(cancelled.cancelled()).toBe(true);

    const failed = stubStream();
    const b = await withGenerationBudget(failed.model, sol, budget).doStream(params);
    failed.fail(new Error("socket reset"));
    await expect(drain(b.stream)).rejects.toThrow("socket reset");

    const unfinished = stubStream();
    const c = await withGenerationBudget(unfinished.model, sol, budget).doStream(params);
    unfinished.push(finish({ inputTokens: {}, outputTokens: {} }));
    unfinished.close();
    await drain(c.stream);

    expect(budget.totals().uncertain?.calls).toBe(3);
    expect(budget.totals().calls).toBe(0);
  });

  test("a stream the estimate cannot bound is refused before dispatch, as a generate is", async () => {
    const budget = createBudget({ capUsd: 1, capTokens: 1_000_000 });
    const stub = stubStream();
    const withImage: PreparedCall = {
      ...params,
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "image/png",
              data: { type: "data", data: new Uint8Array(8) },
            },
          ],
        },
      ],
    };
    await expect(
      withGenerationBudget(stub.model, "gpt-4o", budget).doStream(withImage),
    ).rejects.toThrow("could not be budgeted");
    expect(stub.dispatched()).toBe(0);
  });

  test("through `ai.model` and `streamText`: one log line with the step, and the budget settled from it", async () => {
    const lines: string[] = [];
    const logger = pino(
      { level: "info" },
      new Writable({
        write(chunk, _encoding, callback) {
          lines.push(chunk.toString());
          callback();
        },
      }),
    );
    const ai = createFakeAi({
      logger,
      modelIds: { frontier: sol },
      usage: { inputTokens: 1_200, outputTokens: 300 },
    });
    const budget = createBudget({ capUsd: 1, capTokens: 1_000_000 });
    const model = withGenerationBudget(
      ai.model("frontier", { stage: "write", effort: "low" }),
      sol,
      budget,
    );
    // As with a generate, a stream with no output cap cannot be budgeted and is refused.
    await streamText({ model, prompt: "brief", maxRetries: 0, maxOutputTokens: 4_000 }).text;
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "").ai).toMatchObject({
      modelId: sol,
      stage: "write",
      effort: "low",
      inputTokens: 1_200,
      outputTokens: 300,
    });
    expect(budget.totals()).toMatchObject({ calls: 1, inputTokens: 1_200, outputTokens: 300 });
    expect(budget.totals().reserved).toBeUndefined();
  });
});
