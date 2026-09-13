import { costUsd, isPriced, type TokenUsage } from "./prices";

/*
 * Per-Lesson budget (ADR 0025 §15): provider dispatch reserves synchronously, usage settles once.
 * Confirmed usage, pending estimates and uncertain billing remain distinct. Unpriced reservations
 * switch admission to tokens for the rest of the run; only confirmed usage changes confirmed USD.
 */

export interface BudgetOptions {
  /** `AI_LESSON_COST_CAP_USD`. */
  capUsd: number;
  /** `AI_LESSON_TOKEN_CAP`: input + output tokens, used once an unpriced model is charged. */
  capTokens: number;
  /** Which model ids have a price; defaults to `PRICES` membership. */
  priced?: ((modelId: string) => boolean) | undefined;
}

export interface BudgetUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** `null` once an unpriced model id has been charged. */
  costUsd: number | null;
}

export interface BudgetTotals extends BudgetUsage {
  /** In-flight estimates, not confirmed provider usage. */
  reserved?: BudgetUsage;
  /** Unknown billing retained conservatively; late complete usage may settle live tokens. */
  uncertain?: BudgetUsage;
}

declare const reservationBrand: unique symbol;
export type BudgetReservation = { readonly [reservationBrand]: true };
export type BudgetLimit = { by: "usd" | "tokens" };

interface Reservation {
  modelId: string;
  usage: BudgetUsage;
  state: "reserved" | "uncertain";
}

export interface Budget {
  /** Synchronous admission; no await can let two callers spend the same allowance. */
  reserve(modelId: string, estimate: TokenUsage): { reservation: BudgetReservation } | BudgetLimit;
  /** Complete provider usage settles once; an unknown/foreign/already settled token is inert. */
  settle(reservation: BudgetReservation, usage: TokenUsage): boolean;
  markUncertain(reservation: BudgetReservation): void;
  /** Diagnostic only: a large refused call does not forbid a later cheaper call. */
  lastRefusal(): BudgetLimit | null;
  /** Legacy confirmed-usage charging for callers outside the reservation boundary. */
  charge(modelId: string, usage: TokenUsage): void;
  /** What is left under the active cap; `usd` is `null` when the cap is tokens. */
  remaining(): { usd: number | null; tokens: number };
  /** Which cap is exceeded, or `null` while the next call may go ahead. */
  exceeded(): { by: "usd" | "tokens" } | null;
  totals(): BudgetTotals;
}

export function createBudget(
  options: BudgetOptions,
  initial: { spent?: Readonly<BudgetTotals> } = {},
): Budget {
  const priced = options.priced ?? isPriced;
  const spent = initial.spent;
  // Copy confirmed aggregates exactly. A previous process's pending calls have unknown billing.
  let confirmed: BudgetUsage =
    spent === undefined
      ? { ...ZERO }
      : {
          calls: spent.calls,
          inputTokens: spent.inputTokens,
          outputTokens: spent.outputTokens,
          costUsd: spent.costUsd,
        };
  const inherited = add(spent?.reserved ?? ZERO, spent?.uncertain ?? ZERO);
  let tokenMode = confirmed.costUsd === null || inherited.costUsd === null;
  const reservations = new Map<BudgetReservation, Reservation>();
  let refused: BudgetLimit | null = null;

  function holds(state?: Reservation["state"]): BudgetUsage {
    let total = state === "reserved" ? { ...ZERO } : { ...inherited };
    for (const record of reservations.values()) {
      if (!state || record.state === state) total = add(total, record.usage);
    }
    return total;
  }

  function usageFor(modelId: string, usage: TokenUsage): BudgetUsage {
    return {
      calls: 1,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: priced(modelId) ? costUsd(modelId, usage) : null,
    };
  }

  function charge(modelId: string, usage: TokenUsage) {
    confirmed = add(confirmed, usageFor(modelId, usage));
    if (confirmed.costUsd === null) tokenMode = true;
  }

  const budget: Budget = {
    reserve(modelId, estimate) {
      if (!validUsage(estimate)) throw new RangeError("Invalid budget reservation estimate.");
      const exhausted = budget.exceeded();
      if (exhausted) {
        refused = { ...exhausted };
        return exhausted;
      }
      const proposed = usageFor(modelId, estimate);
      const next = add(add(confirmed, holds()), proposed);
      const useTokens = tokenMode || proposed.costUsd === null;
      if (
        useTokens ? tokens(next) > options.capTokens : (next.costUsd ?? Infinity) > options.capUsd
      ) {
        refused = { by: useTokens ? "tokens" : "usd" };
        return { ...refused };
      }
      const reservation = Object.freeze({}) as BudgetReservation;
      reservations.set(reservation, { modelId, usage: proposed, state: "reserved" });
      tokenMode = useTokens;
      return { reservation };
    },
    settle(reservation, usage) {
      const record = reservations.get(reservation);
      if (!record) return false;
      if (!validUsage(usage)) {
        record.state = "uncertain";
        return false;
      }
      reservations.delete(reservation);
      charge(record.modelId, usage);
      return true;
    },
    markUncertain(reservation) {
      const record = reservations.get(reservation);
      if (record) record.state = "uncertain";
    },
    lastRefusal: () => (refused ? { ...refused } : null),
    charge,
    remaining() {
      const used = add(confirmed, holds());
      return {
        usd: tokenMode ? null : Math.max(0, options.capUsd - (used.costUsd ?? 0)),
        tokens: Math.max(0, options.capTokens - tokens(used)),
      };
    },
    exceeded() {
      const used = add(confirmed, holds());
      if (!tokenMode) return (used.costUsd ?? 0) >= options.capUsd ? { by: "usd" } : null;
      return tokens(used) >= options.capTokens ? { by: "tokens" } : null;
    },
    totals() {
      const reserved = holds("reserved");
      const uncertain = holds("uncertain");
      return {
        ...confirmed,
        ...(reserved.calls ? { reserved } : {}),
        ...(uncertain.calls ? { uncertain } : {}),
      };
    },
  };
  return budget;
}

const ZERO: BudgetUsage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
const tokens = (usage: BudgetUsage) => usage.inputTokens + usage.outputTokens;
const validUsage = (usage: TokenUsage) =>
  [
    usage.inputTokens,
    usage.outputTokens,
    usage.cachedInputTokens ?? 0,
    usage.cacheWriteInputTokens ?? 0,
  ].every((value) => Number.isSafeInteger(value) && value >= 0) &&
  (usage.cachedInputTokens ?? 0) + (usage.cacheWriteInputTokens ?? 0) <= usage.inputTokens;

function add(a: BudgetUsage, b: BudgetUsage): BudgetUsage {
  return {
    calls: a.calls + b.calls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd === null || b.costUsd === null ? null : a.costUsd + b.costUsd,
  };
}
