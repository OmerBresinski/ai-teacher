import { type LanguageModel, wrapLanguageModel } from "ai";
import type { Budget } from "./budget";
import { estimatePreparedCall } from "./budget-estimate";
import type { TokenUsage } from "./prices";

export class BudgetReservationError extends Error {
  override readonly name = "BudgetReservationError";
  constructor(readonly by: "usd" | "tokens") {
    super("The model call exceeds the remaining budget.");
  }
}
export class UnestimableCallError extends Error {
  override readonly name = "UnestimableCallError";
  constructor() {
    super("The model request could not be budgeted safely.");
  }
}

type FinishUsage = {
  inputTokens?: { total?: number; cacheRead?: number; cacheWrite?: number };
  outputTokens?: { total?: number };
};

const count = (value: number | undefined): value is number =>
  Number.isSafeInteger(value) && (value ?? -1) >= 0;

/** Provider boundary: SDK asset preparation precedes this; output validation follows it. */
export function withGenerationBudget(model: LanguageModel, modelId: string, budget: Budget) {
  // ADR 0018 forbids model-router strings; never fall through to an unbudgeted provider.
  if (typeof model === "string") throw new UnestimableCallError();
  return wrapLanguageModel({
    model,
    middleware: {
      // A streamed call (the lesson designer's design cycles) is reserved the same way and settled
      // from the stream's `finish` part; a stream that ends without usage leaves it uncertain.
      wrapStream: async ({ doStream, params }) => {
        params.abortSignal?.throwIfAborted();
        const estimate = estimatePreparedCall(modelId, params);
        if (!estimate) throw new UnestimableCallError();
        const admitted = budget.reserve(modelId, estimate);
        if ("by" in admitted) throw new BudgetReservationError(admitted.by);
        const { reservation } = admitted;
        let settled = false;
        const uncertain = () => {
          if (!settled) budget.markUncertain(reservation);
          settled = true;
        };
        params.abortSignal?.addEventListener("abort", uncertain, { once: true });
        let result: Awaited<ReturnType<typeof doStream>>;
        try {
          result = await doStream();
        } catch (error) {
          uncertain();
          params.abortSignal?.removeEventListener("abort", uncertain);
          throw error;
        }
        const settle = (chunk: unknown) => {
          const part = chunk as { type?: string; usage?: FinishUsage };
          if (part.type !== "finish" || settled) return;
          const input = part.usage?.inputTokens;
          const output = part.usage?.outputTokens;
          if (input && output && count(input.total) && count(output.total)) {
            budget.settle(reservation, {
              inputTokens: input.total,
              outputTokens: output.total,
              cachedInputTokens: count(input.cacheRead) ? input.cacheRead : 0,
              cacheWriteInputTokens: count(input.cacheWrite) ? input.cacheWrite : 0,
            });
            settled = true;
          } else uncertain();
        };
        const stream = result.stream.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              settle(chunk);
              controller.enqueue(chunk);
            },
            flush() {
              uncertain();
              params.abortSignal?.removeEventListener("abort", uncertain);
            },
          }),
        );
        return { ...result, stream };
      },
      wrapGenerate: async ({ doGenerate, params }) => {
        params.abortSignal?.throwIfAborted();
        const estimate = estimatePreparedCall(modelId, params);
        if (!estimate) throw new UnestimableCallError();
        const admitted = budget.reserve(modelId, estimate);
        if ("by" in admitted) throw new BudgetReservationError(admitted.by);
        const { reservation } = admitted;
        const uncertain = () => budget.markUncertain(reservation);
        params.abortSignal?.addEventListener("abort", uncertain, { once: true });
        try {
          const result = await doGenerate();
          const input = result.usage.inputTokens;
          const output = result.usage.outputTokens;
          if (count(input.total) && count(output.total)) {
            const usage: TokenUsage = {
              inputTokens: input.total,
              outputTokens: output.total,
              cachedInputTokens: count(input.cacheRead) ? input.cacheRead : 0,
              cacheWriteInputTokens: count(input.cacheWrite) ? input.cacheWrite : 0,
            };
            budget.settle(reservation, usage);
          } else uncertain();
          return result;
        } catch (error) {
          uncertain();
          throw error;
        } finally {
          params.abortSignal?.removeEventListener("abort", uncertain);
        }
      },
    },
  });
}
