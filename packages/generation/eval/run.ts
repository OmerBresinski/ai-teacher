#!/usr/bin/env bun
// bun run eval:paid [--briefs <id,id>] [--no-judge] [--planner <planner>] [--plan-only]
//
//   --briefs      run only these briefs (ids are the file names in eval/briefs/), in that order
//   --no-judge    skip the rubric judge (no judge call, no judge spend)
//   --planner     the planner a new lesson takes (`AI_LESSON_PLANNER`; default `legacy`). With
//                 `writer`, the writer's call is tapped and every capped field is fill-scored
//                 against the menu's caps (eval/fill.ts), and each lesson's writer output, events
//                 and slides are saved beside the results (TEACH-110 part af)
//   --plan-only   the writer planner, stopped at the writer's "slides" key: the objectives call
//                 and the writer's plan only, each planned slide checked against its layout's cap
//                 for free; writes <sha>.plan-only.json
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
import { parseArgs } from "node:util";
import {
  type Budget,
  type BudgetUsage,
  type CreatedAi,
  costUsd,
  createAi,
  createBudget,
} from "@tj/ai";
import { z } from "zod";
import { type PhotoPlacer, type Planner, writerRoute } from "../src";
import { stageOf } from "../src/stages/write";
import { WRITER_MODEL } from "../src/writer/services";
import { type EvalBrief, evalBriefs, isSecondaryBrief } from "./briefs";
import {
  deckFields,
  type FieldFill,
  type FillReport,
  fillReport,
  type PlanFitReport,
  planFit,
  type WriterEvent,
  writerStageOf,
} from "./fill";
import { evalPhotoPlacer } from "./photo-placer";
import { RUBRIC_DIMENSIONS, type RubricDimension } from "./rubric-prompt";
import { type BriefResult, type BriefRun, runBrief } from "./run-brief";
import { rubricMean } from "./scorers";
import { planOf } from "./writer-tap";

const EnvSchema = z.object({
  AWS_BEARER_TOKEN_BEDROCK: z.string().optional(),
  AWS_REGION: z.string().optional(),
  /** OpenAI direct (ADR 0031): production's route, and the writer's (`writerRoute`). */
  OPENAI_API_KEY: z.string().optional(),
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
  AI_LESSON_PLANNER: z.enum(["legacy", "objectives-first", "writer"]).optional(),
});

export const UNCONFIGURED_MESSAGE =
  "eval:paid: AI is not configured — set OPENAI_API_KEY or AWS_BEARER_TOKEN_BEDROCK to run the paid eval (nothing was run or written).";

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
  reserved?: BudgetUsage;
  uncertain?: BudgetUsage;
  /** The rubric judge's share of `costUsd` (every attempt, paid or not for a score); `null` when it never ran on a priced id. */
  judgeCostUsd: number | null;
  findings: { error: number; warning: number; specRule: number };
  /** Means over the completed briefs the judge scored; `null` everywhere when none was. */
  rubric: { mean: number | null; dimensions: Record<RubricDimension, number | null> };
  /** Set when the shared budget was exceeded: later briefs were skipped (or the last was cut short). */
  stoppedBy?: "usd" | "tokens";
}

/** One lesson's writer, measured (TEACH-110 part af): `--planner writer` or `--plan-only`. */
export interface WriterRow {
  id: string;
  stage: string;
  /** Slides in the finished lesson (full runs); null on a plan-only run. */
  deckLength: number | null;
  /** Slides the writer's flow planned; null when the plan never arrived. */
  plannedSlides: number | null;
  slidesKeyMs: number | null;
  /** The writer call's reported usage (full runs; a plan-only call is cut before it reports). */
  writerUsage: { inputTokens: number; outputTokens: number; reasoningTokens: number | null } | null;
  /**
   * Plan-only, estimated: what the cut writer call was charged to the budget (`settleCut`): its
   * upper-biased input estimate, the plan's text at about 4 characters a token, and
   * `CUT_REASONING_BOUND` reasoning tokens. A cut call never reports its usage.
   */
  planWriterUsdEstimate?: number | null;
  planFit?: PlanFitReport;
  fill?: FillReport;
}

export interface EvalResults {
  sha: string;
  /** True when the worktree had uncommitted changes: the run is not of `sha` alone. */
  dirty?: boolean;
  mode?: "full" | "plan-only";
  planner?: Planner;
  judge?: boolean;
  at: string;
  models: { frontier: string; standard: string; small: string; judge?: string };
  /** `AI_PLAN_FRONTIER_FROM_YEAR` for the run, when set (TEACH-259). */
  planFrontierFromYear?: number;
  capUsd: number;
  briefs: BriefResult[];
  totals: EvalTotals;
  /** The same totals over the secondary (Year 7+) and primary briefs (TEACH-259). */
  bands?: { secondary: BandTotals; primary: BandTotals };
  /** Per-lesson writer measures, and the fill score over every lesson's fields pooled. */
  writer?: { lessons: WriterRow[]; fill: FillReport | null };
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

/**
 * @param rows the band's results — only the briefs the run reached (a cap stop skips the rest)
 * @param planned how many briefs the band holds, so `completed/briefs` reads against the sample
 *   the comparison was designed on, not against what the cap allowed
 */
export function bandTotals(rows: BriefResult[], planned: number = rows.length): BandTotals {
  const briefs = rows;
  const completed = briefs.filter((b) => b.ok);
  const costs = completed.map((b) => b.costUsd).filter((c): c is number => c !== null);
  return {
    briefs: planned,
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
  const exceeded = budget.exceeded() ?? budget.lastRefusal();
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
    ...(totals.reserved ? { reserved: totals.reserved } : {}),
    ...(totals.uncertain ? { uncertain: totals.uncertain } : {}),
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
  options: {
    /** A pinned judge, `false` for none; absent, `ai`'s `frontier` class judges. */
    judge?: CreatedAi | false;
    planFrontierFromYear?: number;
    planner?: Planner;
    writer?: "full" | "plan-only";
    /** Each brief's run, documents and writer tap included (the deck files are written from it). */
    onRun?: (run: BriefRun, brief: EvalBrief) => Promise<void>;
  } = {},
): Promise<BriefResult[]> {
  const results: BriefResult[] = [];
  for (const brief of briefs) {
    if (budget.exceeded() || budget.lastRefusal()) break;
    const run = await runBrief(brief, {
      ai,
      budget,
      judge: options.judge ?? true,
      images,
      ...(options.planFrontierFromYear !== undefined
        ? { planFrontierFromYear: options.planFrontierFromYear }
        : {}),
      ...(options.planner ? { planner: options.planner } : {}),
      ...(options.writer ? { writer: options.writer } : {}),
    });
    await options.onRun?.(run, brief);
    results.push(run.result);
  }
  return results;
}

/** Pick briefs by id, in the order given; an unknown id throws (a typo never runs everything). */
export function pickBriefs(all: EvalBrief[], ids: string[] | undefined): EvalBrief[] {
  if (!ids || ids.length === 0) return all;
  return ids.map((id) => {
    const brief = all.find((b) => b.id === id);
    if (!brief) throw new Error(`eval:paid: no brief "${id}" (${all.map((b) => b.id).join(", ")})`);
    return brief;
  });
}

export interface EvalArgs {
  briefs?: string[];
  judge: boolean;
  planOnly: boolean;
  planner?: Planner;
}

const PLANNERS = ["legacy", "objectives-first", "writer"] as const;

export function parseEvalArgs(argv: string[]): EvalArgs {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      briefs: { type: "string" },
      "no-judge": { type: "boolean", default: false },
      "plan-only": { type: "boolean", default: false },
      planner: { type: "string" },
    },
  });
  const planner = values.planner;
  if (planner !== undefined && !(PLANNERS as readonly string[]).includes(planner))
    throw new Error(`eval:paid: --planner must be one of ${PLANNERS.join(", ")}`);
  if (values["plan-only"] && planner !== undefined && planner !== "writer")
    throw new Error("eval:paid: --plan-only runs the writer planner");
  const briefs = values.briefs
    ?.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return {
    ...(briefs?.length ? { briefs } : {}),
    judge: !values["no-judge"],
    planOnly: values["plan-only"] ?? false,
    ...(values["plan-only"]
      ? { planner: "writer" as const }
      : planner
        ? { planner: planner as Planner }
        : {}),
  };
}

/**
 * One lesson's writer measures from its run: the plan's fit check (always, once the plan arrived),
 * and on a full run the fill score of every capped field.
 */
export function writerRow(
  run: Pick<BriefRun, "result" | "lesson" | "writer">,
  mode: "full" | "plan-only",
): { row: WriterRow; fields: FieldFill[]; events: WriterEvent[] } | null {
  if (!run.writer) return null;
  const { tap, events } = run.writer;
  const stage = writerStageOf(stageOf(run.lesson.ageBand, run.lesson.yearGroup));
  const plan = planOf(tap.text);
  let full: Record<string, unknown> | null = null;
  if (mode === "full") {
    try {
      full = JSON.parse(tap.text) as Record<string, unknown>;
    } catch {
      full = null;
    }
  }
  const flow = (full ?? plan)?.flow;
  const fields = full ? deckFields(full, stage, events, run.result.id) : [];
  const cut = run.writer.cut;
  const planUsd = cut ? costUsd(WRITER_MODEL, cut) : undefined;
  return {
    row: {
      id: run.result.id,
      stage,
      deckLength: mode === "full" && run.result.ok ? run.result.slides : null,
      plannedSlides: Array.isArray(flow) ? flow.length : null,
      slidesKeyMs: tap.slidesKeyMs,
      writerUsage: tap.usage,
      ...(planUsd !== undefined ? { planWriterUsdEstimate: planUsd } : {}),
      ...(Array.isArray(flow) ? { planFit: planFit(flow, stage) } : {}),
      ...(full ? { fill: fillReport(fields, events) } : {}),
    },
    fields,
    events: events.map((e) => ({ ...e, lesson: run.result.id })),
  };
}

export function formatWriterTable(writer: NonNullable<EvalResults["writer"]>): string {
  const pc = (v: number | null | undefined) => (v === null || v === undefined ? "-" : `${v}%`);
  const lines = [
    "| brief | stage | planned | deck | plan fits / near / over / no cell / unparsed (checked) | body fields | 90-100% | over | median | crammed | clipped |",
    "| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const w of writer.lessons) {
    const c = w.planFit?.counts;
    const fit = c
      ? `${c.fits} / ${c["near-cap"]} / ${c.over} / ${c["no-cell"]} / ${c.unparsed} (${w.planFit?.checked})`
      : "-";
    lines.push(
      `| ${w.id} | ${w.stage} | ${w.plannedSlides ?? "-"} | ${w.deckLength ?? "-"} | ${fit} | ${w.fill?.body.fields ?? "-"} | ${pc(w.fill?.body.nearCapPct)} | ${pc(w.fill?.body.overPct)} | ${pc(w.fill?.body.medianFillPct)} | ${w.fill?.crammed.length ?? "-"} | ${w.fill?.clippedSlides.length ?? "-"} |`,
    );
  }
  const f = writer.fill;
  if (f) {
    lines.push(
      "",
      `Fill, every lesson pooled: ${f.body.fields} body fields, ${f.body.nearCapPct}% at 90-100% of cap, ${f.body.overPct}% over, median ${pc(f.body.medianFillPct)}; all ${f.all.fields} capped fields ${f.all.nearCapPct}% / ${f.all.overPct}%; ${f.crammed.length} crammed slides, ${f.clippedSlides.length} clipped.`,
      "",
      "| layout | body fields | <50 | 50-70 | 70-90 | 90-100 | >100 | median |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...Object.entries(f.byLayout)
        .sort((a, b) => b[1].fields - a[1].fields)
        .map(
          ([t, x]) =>
            `| ${t} | ${x.fields} | ${x.buckets["<50"]}% | ${x.buckets["50-70"]}% | ${x.buckets["70-90"]}% | ${x.buckets["90-100"]}% | ${x.buckets[">100"]}% | ${pc(x.medianFillPct)} |`,
        ),
    );
  }
  return lines.join("\n");
}

async function git(args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "ignore" });
  return (await new Response(proc.stdout).text()).trim();
}
const gitSha = async () => (await git(["rev-parse", "HEAD"])) || "unknown";

if (import.meta.main) {
  const args = parseEvalArgs(process.argv.slice(2));
  const env = EnvSchema.parse(process.env);
  // Production's client: the writer's calls take the writer route (`apps/worker/src/deps.ts`).
  const ai = createAi(env, { route: writerRoute });
  if (ai.kind === "unconfigured") {
    console.error(UNCONFIGURED_MESSAGE);
    process.exit(2);
  }
  const briefs = pickBriefs(evalBriefs(), args.briefs);
  const planner = args.planner ?? env.AI_LESSON_PLANNER;
  const mode = args.planOnly ? "plan-only" : "full";
  const writer = planner === "writer" ? mode : undefined;
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
  const sha = env.GITHUB_SHA ?? (await gitSha());
  const dirty = env.GITHUB_SHA === undefined && (await git(["status", "--porcelain"])) !== "";
  const dir = join(import.meta.dir, "results");
  // Each lesson's writer output, events and slides (content: the results folder is gitignored).
  const deckDir = join(dir, mode === "plan-only" ? `${sha}.plan-only` : sha);
  const lessons: WriterRow[] = [];
  const pooled: { fields: FieldFill[]; events: WriterEvent[] } = { fields: [], events: [] };
  const rows = await runPaidEval(ai, budget, briefs, images, {
    judge: args.judge ? judge : false,
    ...(env.AI_PLAN_FRONTIER_FROM_YEAR !== undefined
      ? { planFrontierFromYear: env.AI_PLAN_FRONTIER_FROM_YEAR }
      : {}),
    ...(planner ? { planner } : {}),
    ...(writer ? { writer } : {}),
    onRun: async (run, brief) => {
      const measured = writerRow(run, mode);
      if (!measured || !run.writer) return;
      lessons.push(measured.row);
      // Fields and events carry their lesson, so slides of different lessons never mix.
      pooled.fields.push(...measured.fields);
      pooled.events.push(...measured.events);
      await mkdir(deckDir, { recursive: true });
      const deck = {
        id: brief.id,
        mode,
        writerRaw: run.writer.tap.text,
        plan: planOf(run.writer.tap.text),
        events: run.writer.events,
        slides: mode === "full" ? run.lesson.slides : [],
        row: measured.row,
      };
      await writeFile(join(deckDir, `${brief.id}.json`), `${JSON.stringify(deck, null, 1)}\n`);
    },
  });
  // A plan-only brief ends in the cancel the tap asked for: that is its success, once planned.
  const done = new Set(lessons.filter((l) => l.plannedSlides !== null).map((l) => l.id));
  const briefRows =
    mode === "plan-only"
      ? rows.map((r) => (done.has(r.id) ? { ...r, ok: true, error: undefined } : r))
      : rows;
  const secondaryIds = new Set(briefs.filter(isSecondaryBrief).map((b) => b.id));
  const results: EvalResults = {
    sha,
    ...(dirty ? { dirty } : {}),
    mode,
    ...(planner ? { planner } : {}),
    judge: args.judge,
    at: new Date().toISOString(),
    models: {
      frontier: ai.modelId("frontier"),
      standard: ai.modelId("standard"),
      small: ai.modelId("small"),
      ...(args.judge ? { judge: judge.modelId("frontier") } : {}),
    },
    ...(env.AI_PLAN_FRONTIER_FROM_YEAR !== undefined
      ? { planFrontierFromYear: env.AI_PLAN_FRONTIER_FROM_YEAR }
      : {}),
    capUsd: env.AI_EVAL_RUN_COST_CAP_USD,
    briefs: briefRows.map(({ error, ...r }) => (error ? { ...r, error } : r)),
    totals: summarise(briefRows, briefs, budget),
    bands: {
      secondary: bandTotals(
        briefRows.filter((r) => secondaryIds.has(r.id)),
        secondaryIds.size,
      ),
      primary: bandTotals(
        briefRows.filter((r) => !secondaryIds.has(r.id)),
        briefs.length - secondaryIds.size,
      ),
    },
    ...(writer
      ? {
          writer: {
            lessons,
            fill: pooled.fields.length ? fillReport(pooled.fields, pooled.events) : null,
          },
        }
      : {}),
  };
  await mkdir(dir, { recursive: true });
  const file = join(dir, mode === "plan-only" ? `${sha}.plan-only.json` : `${sha}.json`);
  await writeFile(file, `${JSON.stringify(results, null, 2)}\n`);
  console.log(formatResultsTable(results));
  if (results.bands) console.log(`\n${formatBandsTable(results.bands)}`);
  if (results.writer) console.log(`\n${formatWriterTable(results.writer)}`);
  console.log(`\nwrote ${file}${dirty ? " (worktree dirty: not the commit alone)" : ""}`);
  // A brief the cap stopped mid-Plan surfaces as `BudgetExceeded`; that is the cap working, not a
  // failure of the pipeline.
  const failedElsewhere = briefRows.some((b) => !b.ok && b.error !== "BudgetExceeded");
  process.exit(failedElsewhere ? 1 : 0);
}
