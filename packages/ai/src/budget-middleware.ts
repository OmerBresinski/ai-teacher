import { APICallError, type LanguageModel, wrapLanguageModel } from "ai";
import type { Budget, BudgetReservation } from "./budget";
import { estimatePreparedCall, failedCallFloor, type PreparedCall } from "./budget-estimate";
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

/**
 * A call with no output, no usage and no abort settles at its prompt's text input (ADR 0025 §15).
 * A throw counts only as a provider HTTP error: a parse failure may follow billed output.
 */
function settleFailed(
  budget: Budget,
  reservation: BudgetReservation,
  params: PreparedCall,
  thrown?: { error: unknown },
) {
  const { error } = thrown ?? {};
  const billedOnlyInput = !thrown || (APICallError.isInstance(error) && !!error.statusCode);
  if (params.abortSignal?.aborted || !billedOnlyInput) budget.markUncertain(reservation);
  else budget.settle(reservation, failedCallFloor(params));
}

/**
 * How long a streamed call may wait with no read pending before its reservation is marked
 * uncertain. The clock only runs while the reader is not asking for a part: a slow provider (the
 * writer reasoning before its first token) holds a read open and is bounded by the call deadlines
 * (180 s / 300 s), not by this. 300 s sits above both, so a live reader is never cut off.
 */
export const STREAM_IDLE_MS = 300_000;

export type GenerationBudgetOptions = {
  /** Idle limit for a streamed call with no read pending; defaults to `STREAM_IDLE_MS`. */
  streamIdleMs?: number;
};

/** Provider boundary: SDK asset preparation precedes this; output validation follows it. */
export function withGenerationBudget(
  model: LanguageModel,
  modelId: string,
  budget: Budget,
  options: GenerationBudgetOptions = {},
) {
  const streamIdleMs = options.streamIdleMs ?? STREAM_IDLE_MS;
  // ADR 0018 forbids model-router strings; never fall through to an unbudgeted provider.
  if (typeof model === "string") throw new UnestimableCallError();
  return wrapLanguageModel({
    model,
    middleware: {
      // A streamed call (the lesson writer's) goes through the same gate as `wrapGenerate`: the
      // reservation is taken before dispatch and held while the stream is open, so a concurrent
      // call sees it, and it settles from the stream's `finish` part. A stream that errors, is
      // cancelled or aborted, or ends without complete usage leaves its reservation uncertain
      // (ADR 0025 §15); a complete `finish` arriving later still settles it once. So does a stream
      // nobody reads: after `streamIdleMs` with no read pending it is marked uncertain and lets go
      // of the abort listener, rather than holding its reservation for the life of the process.
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
        };
        params.abortSignal?.addEventListener("abort", uncertain, { once: true });
        const release = () => params.abortSignal?.removeEventListener("abort", uncertain);
        let result: Awaited<ReturnType<typeof doStream>>;
        try {
          result = await doStream();
        } catch (error) {
          // Nothing was streamed: a provider HTTP error settles at the floor.
          settleFailed(budget, reservation, params, { error });
          release();
          throw error;
        }
        const reader = result.stream.getReader();
        let idle: ReturnType<typeof setTimeout> | undefined;
        const stopIdle = () => clearTimeout(idle);
        const end = () => {
          stopIdle();
          uncertain();
          release();
        };
        const startIdle = () => {
          stopIdle();
          idle = setTimeout(end, streamIdleMs);
          // An unread stream must not keep the process alive on its own.
          (idle as { unref?: () => void }).unref?.();
        };
        startIdle();
        return {
          ...result,
          stream: new ReadableStream({
            async pull(controller) {
              stopIdle();
              let next: Awaited<ReturnType<typeof reader.read>>;
              try {
                next = await reader.read();
              } catch (error) {
                end();
                controller.error(error);
                return;
              }
              if (next.done) {
                end();
                controller.close();
                return;
              }
              const part = next.value;
              if (part.type === "finish" && !settled) {
                const input = part.usage.inputTokens;
                const output = part.usage.outputTokens;
                if (count(input.total) && count(output.total)) {
                  settled = budget.settle(reservation, {
                    inputTokens: input.total,
                    outputTokens: output.total,
                    cachedInputTokens: count(input.cacheRead) ? input.cacheRead : 0,
                    cacheWriteInputTokens: count(input.cacheWrite) ? input.cacheWrite : 0,
                  });
                } else uncertain();
              } else if (part.type === "error") uncertain();
              controller.enqueue(part);
              if (settled) {
                stopIdle();
                release();
              } else startIdle();
            },
            async cancel(reason) {
              end();
              await reader.cancel(reason);
            },
          }),
        };
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
          } else if (result.content.length === 0) settleFailed(budget, reservation, params);
          else {
            // Output came back without usage: its tokens were billed but are unknown.
            uncertain();
          }
          return result;
        } catch (error) {
          settleFailed(budget, reservation, params, { error });
          throw error;
        } finally {
          params.abortSignal?.removeEventListener("abort", uncertain);
        }
      },
    },
  });
}
