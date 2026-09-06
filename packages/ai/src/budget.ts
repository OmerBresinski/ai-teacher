import { costUsd, type TokenUsage } from "./prices";

/*
 * Per-lesson spend cap (ADR 0025 §15). Every pipeline stage charges the budget after each model
 * call and consults `exceeded()` before the next. The cap is USD while every charged model id is
 * priced; the moment an unpriced id is charged the running cost is unknowable, `costUsd` becomes
 * `null` and the cap is the token total instead — never silently absent. `charge` never throws;
 * stopping is the caller's decision.
 */

export interface BudgetOptions {
  /** `AI_LESSON_COST_CAP_USD`. */
  capUsd: number;
  /** `AI_LESSON_TOKEN_CAP`: input + output tokens, used once an unpriced model is charged. */
  capTokens: number;
  /** Which model ids have a price; defaults to `PRICES` membership. */
  priced?: ((modelId: string) => boolean) | undefined;
}

export interface BudgetTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** `null` once an unpriced model id has been charged. */
  costUsd: number | null;
}

export interface Budget {
  charge(modelId: string, usage: TokenUsage): void;
  /** What is left under the active cap; `usd` is `null` when the cap is tokens. */
  remaining(): { usd: number | null; tokens: number };
  /** Which cap is exceeded, or `null` while the next call may go ahead. */
  exceeded(): { by: "usd" | "tokens" } | null;
  totals(): BudgetTotals;
}

export function createBudget(options: BudgetOptions): Budget {
  const priced = options.priced ?? ((modelId: string) => costUsd(modelId, ZERO) !== null);
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let usd: number | null = 0;

  /** The one place the priced/unpriced switch lives. */
  const capIsUsd = () => usd !== null;

  return {
    charge(modelId, usage) {
      calls += 1;
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      if (usd === null) return;
      const cost = priced(modelId) ? costUsd(modelId, usage) : null;
      usd = cost === null ? null : usd + cost;
    },
    remaining() {
      return {
        usd: usd === null ? null : Math.max(0, options.capUsd - usd),
        tokens: Math.max(0, options.capTokens - inputTokens - outputTokens),
      };
    },
    exceeded() {
      if (capIsUsd()) return (usd as number) > options.capUsd ? { by: "usd" } : null;
      return inputTokens + outputTokens > options.capTokens ? { by: "tokens" } : null;
    },
    totals() {
      return { calls, inputTokens, outputTokens, costUsd: usd };
    },
  };
}

const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0 };
