/*
 * The lab's cost ledger: every model call a run makes, by pipeline stage, priced from
 * `@tj/ai` `PRICES`. A lab run prints and writes one per lesson; a bench prints one per model.
 *
 * A stage is read from the call's prompt version first, its pipeline stage second, so the plan
 * stage splits into the objectives call, the facts calls and the fact check, and Illustrate's
 * photo calls are told apart from Generate's. The judge (the rubric scorer) is a row of its own
 * and never part of the lesson total.
 */

import { type CreatedAi, costUsd, isPriced, type TokenUsage } from "@tj/ai";
import { type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import type { CallUsage } from "../src/call";

export const LEDGER_STAGES = [
  "objectives",
  "facts",
  "generate",
  "illustrate",
  "evaluate",
  "repair",
  "verify",
  // The topic-pack experiment (np1): authoring, linking and checking a pack; matching an
  // objective to a section and filling the types it lacks. Pack stages are amortised over uses.
  "pack-write",
  "pack-link",
  "pack-check",
  "select",
  "fill",
  "other",
  "judge",
] as const;
export type LedgerStage = (typeof LEDGER_STAGES)[number];

/** Prompt-version prefix → ledger stage. Anything not listed falls back to the pipeline stage. */
const BY_PROMPT: [RegExp, LedgerStage][] = [
  [/^plan-objectives\./, "objectives"],
  [/^plan-facts(-objective)?\./, "facts"],
  [/^plan-skeleton\./, "facts"],
  [/^verify-facts\./, "verify"],
  [/^(generate-slide|generate-worksheet|generate-worksheet-fill|regenerate|cascade)\./, "generate"],
  [/^(pick-or-requery-photo|shortlist-photos)\./, "illustrate"],
  [/^evaluate\./, "evaluate"],
  [/^(repair|repair-fact)\./, "repair"],
  [/^(pack-rewrite|pack-knowledge)\./, "pack-write"],
  [/^pack-link\./, "pack-link"],
  [/^pack-check\./, "pack-check"],
  [/^pack-select\./, "select"],
  [/^pack-fill\./, "fill"],
  [/^(rubric-judge|judge-addendum)\./, "judge"],
];
const BY_STAGE: Record<string, LedgerStage> = {
  plan: "facts",
  generate: "generate",
  illustrate: "illustrate",
  evaluate: "evaluate",
  repair: "repair",
  verify: "verify",
};

export function ledgerStageOf(context: {
  stage?: string | undefined;
  promptVersion?: string | undefined;
}): LedgerStage {
  const version = context.promptVersion ?? "";
  for (const [re, stage] of BY_PROMPT) if (re.test(version)) return stage;
  return (context.stage && BY_STAGE[context.stage]) || "other";
}

export interface LedgerRow {
  stage: LedgerStage;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** `null` when the model id has no `PRICES` row. */
  usd: number | null;
}

export interface LedgerEntry {
  stage: LedgerStage;
  model: string;
  usage: TokenUsage;
}

/** The run a ledger belongs to and whether its lesson counts toward cost-per-accepted-lesson. */
export interface LedgerRun {
  /** The lab label (`--label`), or the bench cell. */
  run: string;
  /**
   * Whether this lesson's cost counts toward cost-per-accepted-lesson: `true` once the judge
   * accepted it, `false` when it was rejected or never finished, `null` while not yet judged.
   */
  countsTowardAccepted: boolean | null;
}

export interface LedgerJson extends LedgerRun {
  rows: LedgerRow[];
  /** Every stage but `judge`: THE lesson cost figure a report quotes. */
  lesson: Omit<LedgerRow, "stage" | "model">;
  /** `lesson` plus the judge. */
  all: Omit<LedgerRow, "stage" | "model">;
}

export interface Ledger {
  record(entry: LedgerEntry): void;
  /** One row per (stage, model), in `LEDGER_STAGES` order. */
  rows(): LedgerRow[];
  /** Every stage but `judge`; `usd` is `null` when any counted call was unpriced. */
  lessonTotal(): Omit<LedgerRow, "stage" | "model">;
  /** `lessonTotal` plus the judge. */
  allTotal(): Omit<LedgerRow, "stage" | "model">;
  /** Name the run and say whether the lesson counts (see `LedgerRun`); may be called again later. */
  setRun(run: Partial<LedgerRun>): void;
  run(): LedgerRun;
  markdown(): string;
  toJSON(): LedgerJson;
}

const ZERO = { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

function sum(rows: LedgerRow[]): Omit<LedgerRow, "stage" | "model"> {
  const total: Omit<LedgerRow, "stage" | "model"> = { ...ZERO, usd: 0 };
  for (const r of rows) {
    total.calls += r.calls;
    total.inputTokens += r.inputTokens;
    total.outputTokens += r.outputTokens;
    total.cachedInputTokens += r.cachedInputTokens;
    total.usd = total.usd === null || r.usd === null ? null : total.usd + r.usd;
  }
  return total;
}

const usd = (v: number | null) => (v === null ? "unpriced" : `$${v.toFixed(4)}`);

export function createLedger(run: Partial<LedgerRun> = {}): Ledger {
  const rows = new Map<string, LedgerRow>();
  const meta: LedgerRun = {
    run: run.run ?? "run",
    countsTowardAccepted: run.countsTowardAccepted ?? null,
  };
  const ledger: Ledger = {
    setRun(next) {
      if (next.run !== undefined) meta.run = next.run;
      if (next.countsTowardAccepted !== undefined)
        meta.countsTowardAccepted = next.countsTowardAccepted;
    },
    run: () => ({ ...meta }),
    record({ stage, model, usage }) {
      const key = `${stage}\u0000${model}`;
      const row = rows.get(key) ?? { stage, model, ...ZERO, usd: isPriced(model) ? 0 : null };
      row.calls += 1;
      row.inputTokens += usage.inputTokens;
      row.outputTokens += usage.outputTokens;
      row.cachedInputTokens += usage.cachedInputTokens ?? 0;
      const cost = costUsd(model, usage);
      row.usd = row.usd === null || cost === null ? null : row.usd + cost;
      rows.set(key, row);
    },
    rows() {
      return [...rows.values()].sort(
        (a, b) =>
          LEDGER_STAGES.indexOf(a.stage) - LEDGER_STAGES.indexOf(b.stage) ||
          a.model.localeCompare(b.model),
      );
    },
    lessonTotal: () => sum(ledger.rows().filter((r) => r.stage !== "judge")),
    allTotal: () => sum(ledger.rows()),
    markdown() {
      const L = [
        "| stage | model | calls | in | out | cached | USD |",
        "|---|---|---:|---:|---:|---:|---:|",
      ];
      for (const r of ledger.rows())
        L.push(
          `| ${r.stage} | ${r.model} | ${r.calls} | ${r.inputTokens} | ${r.outputTokens} | ${r.cachedInputTokens} | ${usd(r.usd)} |`,
        );
      const t = ledger.lessonTotal();
      L.push(
        `| **lesson total** | | ${t.calls} | ${t.inputTokens} | ${t.outputTokens} | ${t.cachedInputTokens} | **${usd(t.usd)}** |`,
      );
      const all = ledger.allTotal();
      if (all.calls !== t.calls)
        L.push(
          `| with judge | | ${all.calls} | ${all.inputTokens} | ${all.outputTokens} | ${all.cachedInputTokens} | ${usd(all.usd)} |`,
        );
      const counts =
        meta.countsTowardAccepted === null
          ? "not yet judged"
          : meta.countsTowardAccepted
            ? "yes"
            : "no";
      L.push("", `run ${meta.run}; counts toward cost-per-accepted-lesson: ${counts}`);
      return L.join("\n");
    },
    toJSON: () => ({
      ...meta,
      rows: ledger.rows(),
      lesson: ledger.lessonTotal(),
      all: ledger.allTotal(),
    }),
  };
  return ledger;
}

/** The provider's usage as `@tj/ai`'s `TokenUsage`; `null` when the provider gave no totals. */
export function tokenUsageOf(usage: {
  inputTokens?: { total?: number | undefined; cacheRead?: number | undefined } | undefined;
  outputTokens?: { total?: number | undefined } | undefined;
}): TokenUsage | null {
  const input = usage.inputTokens?.total;
  const output = usage.outputTokens?.total;
  if (typeof input !== "number" || typeof output !== "number") return null;
  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: usage.inputTokens?.cacheRead ?? 0,
  };
}

/** A `callStructured` result's usage as `TokenUsage`; `null` when the provider gave no totals. */
export function callUsageOf(usage: CallUsage): TokenUsage | null {
  if (typeof usage.inputTokens !== "number" || typeof usage.outputTokens !== "number") return null;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens ?? 0,
  };
}

/**
 * `ai` with every language-model call recorded in `ledger` under the stage its context names
 * (or `stage`, when forced — the judge). A call that fails, or returns no usage, is not counted:
 * the budget marks it uncertain and the run's error log names it.
 */
export function meteringAi(
  real: CreatedAi,
  ledger: Ledger,
  options: { stage?: LedgerStage } = {},
): CreatedAi {
  if (real.kind === "unconfigured") return real;
  const middleware = (stage: LedgerStage, model: string): LanguageModelMiddleware => ({
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      const usage = tokenUsageOf(result.usage);
      if (usage) ledger.record({ stage, model, usage });
      return result;
    },
  });
  return {
    ...real,
    model: (cls, context) => {
      const inner = real.model(cls, context) as Parameters<typeof wrapLanguageModel>[0]["model"];
      const modelId = typeof inner === "string" ? inner : inner.modelId;
      return wrapLanguageModel({
        model: inner,
        middleware: middleware(options.stage ?? ledgerStageOf(context ?? {}), modelId),
      });
    },
  };
}
