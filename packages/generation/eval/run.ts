#!/usr/bin/env bun
// bun run eval:paid
//
// The paid half of the eval set (ADR 0025 §23): every eval brief through `runLessonPipeline` on
// the real Bedrock client, one budget shared across briefs and capped by AI_EVAL_RUN_COST_CAP_USD,
// everything in memory. Writes `packages/generation/eval/results/<sha>.json` — counts, timings,
// tokens, cost and scores only, never content (ADR 0015) — and prints one table.
//
//   exit 0  the run finished (possibly stopped early at the cap: `totals.stoppedBy` says so)
//   exit 1  a brief failed for a reason other than the cap
//   exit 2  AWS_BEARER_TOKEN_BEDROCK is unset — nothing runs, nothing is written
//
// Never runs in CI without the `run-eval` label or a workflow_dispatch (.github/workflows/eval.yml).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Budget, type CreatedAi, createAi, createBudget } from "@tj/ai";
import { z } from "zod";
import type { PhotoPlacer } from "../src";
import { type EvalBrief, evalBriefs, isSecondaryBrief } from "./briefs";
import { evalPhotoPlacer } from "./photo-placer";
import { RUBRIC_DIMENSIONS, type RubricDimension } from "./rubric-prompt";
import { type BriefResult, runBrief } from "./run-brief";
import { rubricMean } from "./scorers";

const EnvSchema = z.object({
  AWS_BEARER_TOKEN_BEDROCK: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AI_MODEL_FRONTIER: z.string().optional(),
  AI_MODEL_STANDARD: z.string().optional(),
  AI_MODEL_SMALL: z.string().optional(),
  /** The rubric judge's model id (TEACH-259); unset → the `standard` id, never the plan model. */
  AI_MODEL_JUDGE: z.string().optional(),
  /** Plan on the `frontier` class from this year group (TEACH-259); unset → today's Terra everywhere. */
  AI_PLAN_FRONTIER_FROM_YEAR: z.coerce.number().int().min(1).max(13).optional(),
  /** Spend cap for the whole run (env contract default 3.00). */
  AI_EVAL_RUN_COST_CAP_USD: z.coerce.number().nonnegative().default(3),
  /** Per-lesson token cap; the run's token cap is eight of these (one per brief). */
  AI_LESSON_TOKEN_CAP: z.coerce.number().int().positive().default(300_000),
  /** Set: photographs are placed (in memory) so the rubric's `imageFit` is scored (TEACH-220). */
  PEXELS_API_KEY: z.string().optional(),
  GITHUB_SHA: z.string().optional(),
});

export const UNCONFIGURED_MESSAGE =
  "eval:paid: AI is not configured — set AWS_BEARER_TOKEN_BEDROCK to run the paid eval (nothing was run or written).";

export interface EvalTotals {
  briefs: number;
  completed: number;
  failed: number;
  durationMs: number;
  /** Mean per completed brief. */
  meanDurationMs: number | null;
  /** Median over briefs that reached a first slide. */
  p50FirstSlideMs: number | null;
  /** Median Plan wall time over the briefs that reached `planned` (skeleton + facts since TEACH-233). */
  p50PlanMs: number | null;
  /** Median Verify call time over the briefs whose Verify completed — the time TEACH-233 took out of Plan. */
  p50VerifyMs: number | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** The whole budget's spend, judge included; `null` when any priced call was on an unpriced id. */
  costUsd: number | null;
  /** The rubric judge's share of `costUsd` (every attempt, paid or not for a score); `null` when it never ran on a priced id. */
  judgeCostUsd: number | null;
  findings: { error: number; warning: number; specRule: number };
  /** Means over the completed briefs the judge scored; `null` everywhere when none was. */
  rubric: { mean: number | null; dimensions: Record<RubricDimension, number | null> };
  /** Set when the shared budget was exceeded: later briefs were skipped (or the last was cut short). */
  stoppedBy?: "usd" | "tokens";
}

export interface EvalResults {
  sha: string;
  at: string;
  models: { frontier: string; standard: string; small: string; judge?: string };
  /** `AI_PLAN_FRONTIER_FROM_YEAR` for the run, when set (TEACH-259). */
  planFrontierFromYear?: number;
  capUsd: number;
  briefs: BriefResult[];
  totals: EvalTotals;
  /** The same totals over the secondary (Year 7+) and primary briefs (TEACH-259). */
  bands?: { secondary: BandTotals; primary: BandTotals };
}

/** What the Plan-model question is read from, per year band (TEACH-259 FR3). */
export interface BandTotals {
  briefs: number;
  completed: number;
  p50PlanMs: number | null;
  p50VerifyMs: number | null;
  /** Mean spend per completed lesson (the lesson's own, judge excluded). */
  meanCostUsd: number | null;
  specRule: number;
  rubric: EvalTotals["rubric"];
}

export function bandTotals(briefs: BriefResult[]): BandTotals {
  const completed = briefs.filter((b) => b.ok);
  const costs = completed.map((b) => b.costUsd).filter((c): c is number => c !== null);
  return {
    briefs: briefs.length,
    completed: completed.length,
    p50PlanMs: median(numbers(briefs.map((b) => b.planMs))),
    p50VerifyMs: median(numbers(briefs.map((b) => b.verifyMs ?? null))),
    meanCostUsd:
      costs.length === 0
        ? null
        : Math.round((costs.reduce((sum, c) => sum + c, 0) / costs.length) * 1e6) / 1e6,
    specRule: briefs.reduce((sum, b) => sum + (b.findings.specRule ?? 0), 0),
    rubric: rubricTotals(completed),
  };
}

const numbers = (values: (number | null)[]) =>
  values.filter((n): n is number => n !== null).sort((a, b) => a - b);

export function formatBandsTable(bands: NonNullable<EvalResults["bands"]>): string {
  const ms = (v: number | null) => (v === null ? "-" : `${Math.round(v)}`);
  const usd = (v: number | null) => (v === null ? "-" : `$${v.toFixed(4)}`);
  const score = (v: number | null) => (v === null ? "-" : v.toFixed(1));
  const rows = [
    ["briefs", (b: BandTotals) => `${b.completed}/${b.briefs}`],
    ["p50 plan ms", (b: BandTotals) => ms(b.p50PlanMs)],
    ["p50 verify ms", (b: BandTotals) => ms(b.p50VerifyMs)],
    ["cost / lesson", (b: BandTotals) => usd(b.meanCostUsd)],
    ["spec-rule", (b: BandTotals) => String(b.specRule)],
    ["rubric mean", (b: BandTotals) => score(b.rubric.mean)],
    ...RUBRIC_DIMENSIONS.map(
      (d) => [`rubric: ${d}`, (b: BandTotals) => score(b.rubric.dimensions[d])] as const,
    ),
  ] as const;
  return [
    "| | secondary (Year 7+) | primary |",
    "| --- | ---: | ---: |",
    ...rows.map(
      ([label, read]) => `| ${label} | ${read(bands.secondary)} | ${read(bands.primary)} |`,
    ),
  ].join("\n");
}

/** The median of a sorted sample: the middle value, or the mean of the two middles. */
export function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = sorted.length / 2;
  if (sorted.length % 2 === 1) return sorted[Math.floor(mid)] ?? null;
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  return lower === undefined || upper === undefined ? null : (lower + upper) / 2;
}

export function summarise(briefs: BriefResult[], all: EvalBrief[], budget: Budget): EvalTotals {
  const completed = briefs.filter((b) => b.ok);
  const firsts = briefs
    .map((b) => b.firstSlideMs)
    .filter((ms): ms is number => ms !== null)
    .sort((a, b) => a - b);
  // Every brief that reached `planned`, whether or not it went on to complete: Plan's time is
  // Plan's, as `firstSlideMs` is.
  const plans = briefs
    .map((b) => b.planMs)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  const verifies = briefs
    .map((b) => b.verifyMs ?? null)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  const totals = budget.totals();
  const findings = { error: 0, warning: 0, specRule: 0 };
  for (const b of briefs) {
    findings.error += b.findings.error;
    findings.warning += b.findings.warning;
    findings.specRule += b.findings.specRule ?? 0;
  }
  const exceeded = budget.exceeded();
  const judged = completed
    .map((b) => b.judge?.costUsd ?? null)
    .filter((c): c is number => c !== null);
  return {
    briefs: all.length,
    completed: completed.length,
    failed: briefs.length - completed.length,
    durationMs: briefs.reduce((sum, b) => sum + b.durationMs, 0),
    meanDurationMs:
      completed.length === 0
        ? null
        : Math.round(completed.reduce((sum, b) => sum + b.durationMs, 0) / completed.length),
    p50FirstSlideMs:
      firsts.length === 0 ? null : (firsts[Math.floor((firsts.length - 1) / 2)] ?? null),
    p50PlanMs: median(plans),
    p50VerifyMs: median(verifies),
    calls: totals.calls,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    costUsd: totals.costUsd,
    judgeCostUsd:
      judged.length === 0 ? null : Math.round(judged.reduce((sum, c) => sum + c, 0) * 1e6) / 1e6,
    findings,
    rubric: rubricTotals(completed),
    ...(exceeded ? { stoppedBy: exceeded.by } : {}),
  };
}

/** Per-dimension means over the briefs whose rubric was scored, one decimal; then their mean. */
export function rubricTotals(briefs: BriefResult[]): EvalTotals["rubric"] {
  const dimensions = {} as Record<RubricDimension, number | null>;
  for (const d of RUBRIC_DIMENSIONS) {
    const scores = briefs
      .map((b) => b.scores?.rubric?.dimensions[d] ?? null)
      .filter((s): s is number => s !== null);
    dimensions[d] =
      scores.length === 0
        ? null
        : Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10;
  }
  return { mean: rubricMean(dimensions), dimensions };
}

export function formatResultsTable(results: EvalResults): string {
  const usd = (v: number | null) => (v === null ? "-" : `$${v.toFixed(4)}`);
  const lines = [
    "| brief | ok | ms | plan ms | verify ms | first slide ms | slides | calls | tokens in/out | cost | errors | warnings | spec-rule | schema | model | rubric |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const b of results.briefs) {
    lines.push(
      `| ${b.id} | ${b.ok ? "yes" : `no (${b.error})`} | ${b.durationMs} | ${b.planMs ?? "-"} | ${b.verifyMs ?? "-"} | ${b.firstSlideMs ?? "-"} | ${b.slides} | ${b.calls} | ${b.inputTokens}/${b.outputTokens} | ${usd(b.costUsd)} | ${b.findings.error} | ${b.findings.warning} | ${b.findings.specRule ?? 0} | ${b.scores?.schema ?? "-"} | ${b.scores?.modelFindings ?? "-"} | ${b.scores?.rubric?.mean ?? "-"} |`,
    );
  }
  const t = results.totals;
  lines.push(
    "",
    `Totals: ${t.completed}/${t.briefs} briefs, ${t.calls} calls, ${t.inputTokens}/${t.outputTokens} tokens, ${usd(t.costUsd)} (cap $${results.capUsd.toFixed(2)}), mean ${t.meanDurationMs ?? "-"} ms, p50 plan ${t.p50PlanMs ?? "-"} ms, p50 verify ${t.p50VerifyMs ?? "-"} ms, p50 first slide ${t.p50FirstSlideMs ?? "-"} ms, ${t.findings.error} errors / ${t.findings.warning} warnings (${t.findings.specRule} spec-rule), rubric mean ${t.rubric.mean ?? "-"}${t.stoppedBy ? ` — stopped at the ${t.stoppedBy} cap` : ""}`,
  );
  return lines.join("\n");
}

/** Run every brief in order over one budget; stops once the budget is exceeded. */
export async function runPaidEval(
  ai: CreatedAi,
  budget: Budget,
  briefs = evalBriefs(),
  images?: PhotoPlacer,
  options: { judge?: CreatedAi; planFrontierFromYear?: number } = {},
): Promise<BriefResult[]> {
  const results: BriefResult[] = [];
  for (const brief of briefs) {
    if (budget.exceeded()) break;
    const run = await runBrief(brief, {
      ai,
      budget,
      judge: options.judge ?? true,
      images,
      ...(options.planFrontierFromYear !== undefined
        ? { planFrontierFromYear: options.planFrontierFromYear }
        : {}),
    });
    results.push(run.result);
  }
  return results;
}

async function gitSha(): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(proc.stdout).text()).trim();
  return out || "unknown";
}

if (import.meta.main) {
  const env = EnvSchema.parse(process.env);
  const ai = createAi(env);
  if (ai.kind === "unconfigured") {
    console.error(UNCONFIGURED_MESSAGE);
    process.exit(2);
  }
  const briefs = evalBriefs();
  const budget = createBudget({
    capUsd: env.AI_EVAL_RUN_COST_CAP_USD,
    capTokens: briefs.length * env.AI_LESSON_TOKEN_CAP,
  });
  // The judge is never the model under test (TEACH-259): its own `CreatedAi` whose `frontier`
  // class — the one the scorer asks for — is `AI_MODEL_JUDGE`, or the `standard` id by default.
  const judge = createAi({
    ...env,
    AI_MODEL_FRONTIER: env.AI_MODEL_JUDGE ?? ai.modelId("standard"),
  });
  if (judge.kind === "unconfigured") throw new Error("eval:paid: judge model is not configured");
  const images = env.PEXELS_API_KEY ? evalPhotoPlacer(env.PEXELS_API_KEY) : undefined;
  const rows = await runPaidEval(ai, budget, briefs, images, {
    judge,
    ...(env.AI_PLAN_FRONTIER_FROM_YEAR !== undefined
      ? { planFrontierFromYear: env.AI_PLAN_FRONTIER_FROM_YEAR }
      : {}),
  });
  const secondaryIds = new Set(briefs.filter(isSecondaryBrief).map((b) => b.id));
  const results: EvalResults = {
    sha: env.GITHUB_SHA ?? (await gitSha()),
    at: new Date().toISOString(),
    models: {
      frontier: ai.modelId("frontier"),
      standard: ai.modelId("standard"),
      small: ai.modelId("small"),
      judge: judge.modelId("frontier"),
    },
    ...(env.AI_PLAN_FRONTIER_FROM_YEAR !== undefined
      ? { planFrontierFromYear: env.AI_PLAN_FRONTIER_FROM_YEAR }
      : {}),
    capUsd: env.AI_EVAL_RUN_COST_CAP_USD,
    briefs: rows,
    totals: summarise(rows, briefs, budget),
    bands: {
      secondary: bandTotals(rows.filter((r) => secondaryIds.has(r.id))),
      primary: bandTotals(rows.filter((r) => !secondaryIds.has(r.id))),
    },
  };
  const dir = join(import.meta.dir, "results");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${results.sha}.json`);
  await writeFile(file, `${JSON.stringify(results, null, 2)}\n`);
  console.log(formatResultsTable(results));
  if (results.bands) console.log(`\n${formatBandsTable(results.bands)}`);
  console.log(`\nwrote ${file}`);
  // A brief the cap stopped mid-Plan surfaces as `BudgetExceeded`; that is the cap working, not a
  // failure of the pipeline.
  const failedElsewhere = rows.some((b) => !b.ok && b.error !== "BudgetExceeded");
  process.exit(failedElsewhere ? 1 : 0);
}
