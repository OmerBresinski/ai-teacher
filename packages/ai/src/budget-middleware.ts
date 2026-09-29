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

const count = (value: number | undefined): value is number =>
  Number.isSafeInteger(value) && (value ?? -1) >= 0;

/** Provider boundary: SDK asset preparation precedes this; output validation follows it. */
export function withGenerationBudget(model: LanguageModel, modelId: string, budget: Budget) {
  // ADR 0018 forbids model-router strings; never fall through to an unbudgeted provider.
  if (typeof model === "string") throw new UnestimableCallError();
  return wrapLanguageModel({
    model,
    middleware: {
      // Lab fit-single-writer: a stream is reserved like a generate call and settled from its
      // `finish` part; a stream that ends without usage (or errors) is marked uncertain.
      wrapStream: async ({ doStream, params }) => {
        params.abortSignal?.throwIfAborted();
        const estimate = estimatePreparedCall(modelId, params);
        if (!estimate) throw new UnestimableCallError();
        const admitted = budget.reserve(modelId, estimate);
        if ("by" in admitted) throw new BudgetReservationError(admitted.by);
        const { reservation } = admitted;
        let settled = false;
        const uncertain = () => {
          if (settled) return;
          settled = true;
          budget.markUncertain(reservation);
        };
        let result: Awaited<ReturnType<typeof doStream>>;
        try {
          result = await doStream();
        } catch (error) {
          uncertain();
          throw error;
        }
        const settle = new TransformStream({
          transform(part, controller) {
            const p = part as {
              type?: string;
              usage?: {
                inputTokens: { total?: number; cacheRead?: number; cacheWrite?: number };
                outputTokens: { total?: number };
              };
            };
            if (p.type === "finish" && p.usage && !settled) {
              const input = p.usage.inputTokens;
              const output = p.usage.outputTokens;
              if (count(input.total) && count(output.total)) {
                settled = true;
                budget.settle(reservation, {
                  inputTokens: input.total,
                  outputTokens: output.total,
                  cachedInputTokens: count(input.cacheRead) ? input.cacheRead : 0,
                  cacheWriteInputTokens: count(input.cacheWrite) ? input.cacheWrite : 0,
                });
              }
            }
            controller.enqueue(part);
          },
          flush: uncertain,
        });
        return { ...result, stream: result.stream.pipeThrough(settle) } as typeof result;
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
