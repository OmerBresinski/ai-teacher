import type { AiCallContext, Budget, BudgetReservation, CreatedAi, TokenUsage } from "@tj/ai";
import { wrapLanguageModel } from "ai";

/*
 * A read-only tap on the lesson writer's one streamed call (stage `write`), for the eval
 * (TEACH-110 part af). Every other call, and the writer call itself, run exactly as production runs
 * them: the tap wraps the model `deps.ai.model` hands the stage, inside the stage's own budget
 * wrapper, and passes every stream part through unchanged. It keeps the writer's raw text (for the
 * fill score) and the call's reported usage. In plan-only mode it calls `onSlidesKey` as soon as
 * the text reaches the top-level `"slides"` key; the caller aborts the brief there, so the writer
 * is billed for its input, its reasoning and the plan, never for the slides.
 */

/** What the tap saw of the writer call. */
export interface WriterTap {
  /** The writer's raw output so far (the whole JSON on a full run, the plan on a plan-only one). */
  text: string;
  /** Milliseconds from the call to the `"slides"` key, when it was reached. */
  slidesKeyMs: number | null;
  /** The provider's usage from the stream's `finish` part; absent when the call was cut short. */
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number | null } | null;
}

/** A top-level `"slides"` key: an unescaped quote, so never the word inside a JSON string. */
const SLIDES_KEY = /(?<!\\)"slides"\s*:/;

/** The index of the writer's `"slides"` key in its raw text, or -1. */
export function slidesKeyAt(text: string): number {
  return text.search(SLIDES_KEY);
}

/**
 * The writer's plan: its raw JSON up to the `"slides"` key, closed (`design`, `flow`, `title`).
 * Null when the key was never reached or the prefix does not parse.
 */
export function planOf(text: string): Record<string, unknown> | null {
  const at = slidesKeyAt(text);
  if (at < 0) return null;
  const head = text.slice(0, at).replace(/[\s,]+$/, "");
  try {
    return JSON.parse(`${head}}`) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const isWriterCall = (context: AiCallContext | undefined) => context?.stage === "write";

export function tapWriter(
  ai: CreatedAi,
  options: { onSlidesKey?: (tap: WriterTap) => void } = {},
): { ai: CreatedAi; tap: WriterTap } {
  const tap: WriterTap = { text: "", slidesKeyMs: null, usage: null };
  const model: CreatedAi["model"] = (cls, context) => {
    const inner = ai.model(cls, context);
    if (!isWriterCall(context) || typeof inner === "string") return inner;
    return wrapLanguageModel({
      model: inner,
      middleware: {
        wrapStream: async ({ doStream }) => {
          const t0 = Date.now();
          tap.text = "";
          tap.slidesKeyMs = null;
          tap.usage = null;
          const result = await doStream();
          const seen = new TransformStream({
            transform(part, controller) {
              controller.enqueue(part);
              const p = part as {
                type: string;
                delta?: string;
                usage?: {
                  inputTokens?: { total?: number };
                  outputTokens?: { total?: number; reasoning?: number };
                };
              };
              if (p.type === "text-delta" && typeof p.delta === "string") {
                tap.text += p.delta;
                if (tap.slidesKeyMs === null && slidesKeyAt(tap.text) >= 0) {
                  tap.slidesKeyMs = Date.now() - t0;
                  options.onSlidesKey?.(tap);
                }
              }
              if (p.type === "finish" && p.usage) {
                tap.usage = {
                  inputTokens: p.usage.inputTokens?.total ?? 0,
                  outputTokens: p.usage.outputTokens?.total ?? 0,
                  reasoningTokens: p.usage.outputTokens?.reasoning ?? null,
                };
              }
            },
          });
          return { ...result, stream: result.stream.pipeThrough(seen) };
        },
      },
    });
  };
  return { ai: { ...ai, model } as CreatedAi, tap };
}

/**
 * A cut writer call's reasoning is never reported; this bounds it when the call is settled. Low
 * effort reasoned for 113 tokens on the 17 Oct proof lesson; 2,000 is a generous ceiling.
 */
export const CUT_REASONING_BOUND = 2000;

/** One reservation a brief took on the shared budget. */
interface Held {
  modelId: string;
  estimate: TokenUsage;
  reservation: BudgetReservation;
}

/**
 * The shared budget as one brief sees it: every reservation it takes is remembered, so the ones a
 * plan-only cut leaves uncertain can be settled after the brief (`settleCut`) instead of holding
 * their full upper-biased estimate against the cap for the rest of the run.
 */
export function trackReservations(budget: Budget): { budget: Budget; held: Held[] } {
  const held: Held[] = [];
  return {
    held,
    budget: {
      ...budget,
      reserve(modelId, estimate) {
        const admitted = budget.reserve(modelId, estimate);
        if ("reservation" in admitted)
          held.push({ modelId, estimate, reservation: admitted.reservation });
        return admitted;
      },
    },
  };
}

/**
 * Settle what a cut brief left open, once it has ended. The writer call is charged its input
 * estimate plus the text it streamed (about 4 characters a token) and `CUT_REASONING_BOUND`, never
 * more than its reservation's output; any other open call at its full estimate. Calls that settled
 * themselves are untouched (`settle` is inert on them). Returns what the writer call was charged.
 */
export function settleCut(
  budget: Budget,
  held: Held[],
  tap: WriterTap,
  writerModelId: string,
): { inputTokens: number; outputTokens: number } | null {
  let writer: { inputTokens: number; outputTokens: number } | null = null;
  for (const h of held) {
    const isWriter: boolean = h.modelId === writerModelId && writer === null;
    const usage: TokenUsage = isWriter
      ? {
          inputTokens: h.estimate.inputTokens,
          outputTokens: Math.min(
            h.estimate.outputTokens,
            Math.ceil(tap.text.length / 4) + CUT_REASONING_BOUND,
          ),
        }
      : { inputTokens: h.estimate.inputTokens, outputTokens: h.estimate.outputTokens };
    if (budget.settle(h.reservation, usage) && isWriter) writer = usage;
  }
  return writer;
}
