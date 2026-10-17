import { describe, expect, test } from "bun:test";
import { type Budget, type CreatedAi, createBudget, withGenerationBudget } from "@tj/ai";
import { simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  CUT_REASONING_BOUND,
  planOf,
  settleCut,
  slidesKeyAt,
  tapWriter,
  trackReservations,
} from "./writer-tap";

const RAW =
  '{"design":{"picture_style":"photo"},"flow":[{"slide":1,"does":"say \\"slides\\" here"}],"title":{"heading":"T"},"slides":[{"template":"explain"}],"close":null}';

function fakeAi(chunks: string[]): CreatedAi {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          ...chunks.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
          { type: "text-end", id: "t" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 300, text: 100, reasoning: 200 },
            },
          },
        ] as never,
      }),
    }),
  });
  return { kind: "openai", region: "x", model: () => model, modelId: () => "openai/gpt-6.1-sol" };
}

describe("writer tap", () => {
  test("finds the top-level slides key, never the word inside a string", () => {
    expect(slidesKeyAt(RAW)).toBe(RAW.indexOf('"slides":['));
    expect(planOf(RAW)).toEqual({
      design: { picture_style: "photo" },
      flow: [{ slide: 1, does: 'say "slides" here' }],
      title: { heading: "T" },
    });
    expect(planOf('{"design":{}')).toBeNull();
  });

  test("passes the writer's stream through unchanged and keeps its text and usage", async () => {
    const { ai, tap } = tapWriter(fakeAi([RAW.slice(0, 60), RAW.slice(60)]));
    const r = streamText({ model: ai.model("frontier", { stage: "write" }), prompt: "p" });
    expect(await r.text).toBe(RAW);
    expect(tap.text).toBe(RAW);
    expect(tap.slidesKeyMs).not.toBeNull();
    expect(tap.usage).toEqual({ inputTokens: 900, outputTokens: 300, reasoningTokens: 200 });
  });

  test("other stages are not tapped", async () => {
    const other = tapWriter(fakeAi(["{}"]));
    await streamText({ model: other.ai.model("small", { stage: "write-small" }), prompt: "p" })
      .text;
    expect(other.tap.text).toBe("");
  });
});

const SOL = "openai/gpt-6.1-sol";

/**
 * A provider that streams the plan up to the slides key, then holds the rest until it is read;
 * like OpenAI's fetch, it errors its stream when the call's signal aborts. `state` says whether
 * the slides ever went out and whether the stream was cut.
 */
function slowAi() {
  const state = { cancelled: false, sentSlides: false };
  const head = RAW.slice(0, RAW.indexOf('"slides"') + 10);
  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      let ctl!: ReadableStreamDefaultController<unknown>;
      let step = 0;
      const stream = new ReadableStream<unknown>({
        start(c) {
          ctl = c;
          abortSignal?.addEventListener("abort", () => {
            state.cancelled = true;
            c.error(new DOMException("aborted", "AbortError"));
          });
        },
        async pull(c) {
          const parts = [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: head },
          ];
          if (step < parts.length) {
            c.enqueue(parts[step++]);
            return;
          }
          // The model takes a moment over the next token; a cut call never gets to send it.
          await new Promise((r) => setTimeout(r, 20));
          if (state.cancelled) return;
          state.sentSlides = true;
          c.enqueue({ type: "text-delta", id: "t", delta: RAW.slice(head.length) });
          c.close();
        },
        cancel() {
          state.cancelled = true;
        },
      });
      void ctl;
      return { stream: stream as never };
    },
  });
  const ai: CreatedAi = { kind: "openai", region: "x", model: () => model, modelId: () => SOL };
  return { ai, state };
}

/** One plan-only writer call as the eval runs it: tapped, budgeted, cut at the slides key. */
async function cutCall(budget: Budget) {
  const stop = new AbortController();
  const { ai, state } = slowAi();
  const tracked = trackReservations(budget);
  const { ai: tapped, tap } = tapWriter(ai, { onSlidesKey: () => stop.abort() });
  const model = withGenerationBudget(
    tapped.model("frontier", { stage: "write" }),
    SOL,
    tracked.budget,
  );
  const r = streamText({ model, prompt: "plan", maxOutputTokens: 9000, abortSignal: stop.signal });
  let error: unknown;
  try {
    for await (const _ of r.textStream) {
      // read until the cut
    }
  } catch (e) {
    error = e;
  }
  const uncertainBefore = budget.totals().uncertain?.calls ?? 0;
  const charged = settleCut(tracked.budget, tracked.held, tap, SOL);
  return { state, tap, error, aborted: stop.signal.aborted, uncertainBefore, charged };
}

describe("plan-only cut (TEACH-110 part af)", () => {
  test("aborts at the slides key: the stream is cut, the slides never sent, the hold settled", async () => {
    const budget = createBudget({ capUsd: 1, capTokens: 1e9 });
    const c = await cutCall(budget);
    expect(c.aborted).toBe(true);
    expect(c.state.cancelled).toBe(true);
    expect(c.state.sentSlides).toBe(false);
    expect(slidesKeyAt(c.tap.text)).toBeGreaterThan(0);
    expect(planOf(c.tap.text)?.flow).toBeDefined();
    // The cut left its reservation uncertain; settleCut charged it once, and nothing stays held.
    expect(c.uncertainBefore).toBe(1);
    const t = budget.totals();
    expect(t.uncertain).toBeUndefined();
    expect(t.reserved).toBeUndefined();
    expect(t.calls).toBe(1);
    // Fixed: the budget's input estimate for this prompt, the streamed plan at 4 characters a
    // token (120 characters -> 30) plus the reasoning bound, at $2 / $10 per million.
    expect(c.charged).toEqual({ inputTokens: 4243, outputTokens: 30 + CUT_REASONING_BOUND });
    expect(t.costUsd).toBeCloseTo(4243 * 2e-6 + 2030 * 10e-6, 9);
  });

  test("settled cuts never starve later briefs on a shared cap", async () => {
    // One reservation is ~$0.098 (9,000 output tokens at $10/M); two stale holds would not fit in $0.18, three settled cuts do.
    const budget = createBudget({ capUsd: 0.18, capTokens: 1e9 });
    for (let i = 0; i < 3; i++) {
      const c = await cutCall(budget);
      expect(c.state.cancelled).toBe(true);
      expect(c.charged).not.toBeNull();
    }
    expect(budget.totals().calls).toBe(3);
    expect(budget.exceeded()).toBeNull();
  });

  test("without the settle, the stale hold refuses the next brief", async () => {
    const budget = createBudget({ capUsd: 0.18, capTokens: 1e9 });
    const first = slowAi();
    const stop = new AbortController();
    const { ai, tap } = tapWriter(first.ai, { onSlidesKey: () => stop.abort() });
    const model = withGenerationBudget(ai.model("frontier", { stage: "write" }), SOL, budget);
    const r = streamText({
      model,
      prompt: "plan",
      maxOutputTokens: 9000,
      abortSignal: stop.signal,
    });
    await Promise.resolve(r.text).catch(() => undefined);
    expect(slidesKeyAt(tap.text)).toBeGreaterThan(0);
    expect(budget.totals().uncertain?.calls).toBe(1);
    expect(budget.reserve(SOL, { inputTokens: 4243, outputTokens: 9000 })).toEqual({ by: "usd" });
  });
});
