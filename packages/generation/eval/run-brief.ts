import { Writable } from "node:stream";
import type { Budget, CreatedAi } from "@tj/ai";
import { type Lesson, lessonFromBrief, type Worksheet } from "@tj/domain/documents";
import pino from "pino";
import {
  noSources,
  type PhotoPlacer,
  type PipelineDeps,
  runLessonPipeline,
  SPEC_RULE_CHECK,
  StageFailure,
} from "../src";
import type { EvalBrief } from "./briefs";
import type { RubricDimension } from "./rubric-prompt";
import { type EvalScores, scoreLesson } from "./scorers";

/*
 * One eval brief through the real pipeline (ADR 0025 §23), with the worker's `persist` contract
 * replaced by memory: every persist is counted and stamped, the first one carrying a slide gives
 * `firstSlideMs`. Nothing touches Postgres or storage. Shared by the schema half (scripted fake)
 * and the paid half (Bedrock); only `ai`, `budget` and `judge` differ: the paid half scores the
 * rubric with one extra `frontier` call per brief, the schema half never spends.
 */

export interface BriefResult {
  id: string;
  ok: boolean;
  /** The error name (plus a timeout reason) when failed; never content-bearing messages. */
  error?: string;
  durationMs: number;
  /** Time to the first persisted lesson with at least one slide; `null` when none arrived. */
  firstSlideMs: number | null;
  /**
   * Time to the `planned` checkpoint — Plan's wall time, the number the Plan tickets watch. Since
   * TEACH-233 this is skeleton + facts: Verify is started at the checkpoint and awaited by Generate.
   */
  planMs: number | null;
  /**
   * Verify's own call time, from the pipeline's `facts verified` log record (`durationMs`); `null`
   * when Verify did not complete (refused at the cap, two misses, or a brief that failed first).
   * `planMs + verifyMs` is what `planMs` measured before TEACH-233.
   */
  verifyMs: number | null;
  slides: number;
  blocks: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /**
   * The lesson's own spend — `null` when the model id is unpriced (the token cap applied) or the
   * run failed early. `calls`, the tokens and this are the pipeline's alone; the rubric judge's
   * usage is under `judge`, so the number is comparable with the per-lesson target.
   */
  costUsd: number | null;
  /**
   * What the rubric judge used on this brief, from the budget's deltas — so a judge attempt that
   * was paid for but failed validation or hit the cap is still counted. `null` when the judge was
   * not asked (the schema half, or a brief that failed).
   */
  judge: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
  } | null;
  /** By severity; `specRule` counts the `spec-rule` findings of either severity (TEACH-257). */
  findings: { error: number; warning: number; specRule: number };
  scores: EvalScores | null;
  /**
   * The judge's one-line rationales, present only when the rubric was scored. Read by nobody:
   * `formatResultsTable` and `renderComment` never print them (ADR 0015; the results file is
   * gitignored, the PR comment is not).
   */
  rubricRationales?: Record<RubricDimension, string>;
}

/** What one run hands back: the serialisable row and, in memory only, the documents behind it. */
export interface BriefRun {
  result: BriefResult;
  lesson: Lesson;
  worksheet?: Worksheet;
}

export interface RunBriefOptions {
  ai: CreatedAi;
  budget: Budget;
  now?: () => Date;
  signal?: AbortSignal;
  /**
   * Score the rubric (the paid half only): `true` uses `ai`'s `frontier` class; a `CreatedAi` is
   * a judge pinned separately (`AI_MODEL_JUDGE`, TEACH-259) so it is never the model under test.
   * Either way on the same `budget`.
   */
  judge?: boolean | CreatedAi;
  /** Place photographs (TEACH-220): absent, `image-text` slides keep the placeholder. */
  images?: PhotoPlacer | undefined;
  /** Plan on the `frontier` class from this year group (TEACH-259, `AI_PLAN_FRONTIER_FROM_YEAR`). */
  planFrontierFromYear?: number;
}

let counter = 0;
const nextId = () => `ev${(++counter).toString(36)}`;

/** The lesson `POST /lessons` would create for the brief, with fixed ids so runs are comparable. */
export function lessonForBrief(brief: EvalBrief, now: Date): Lesson {
  return lessonFromBrief(brief.input, `eval-${brief.id}`, now);
}

export async function runBrief(brief: EvalBrief, options: RunBriefOptions): Promise<BriefRun> {
  const now = options.now ?? (() => new Date());
  const startedAt = Date.now();
  const before = options.budget.totals();
  let firstSlideMs: number | null = null;
  let planMs: number | null = null;
  let verifyMs: number | null = null;
  let lesson = lessonForBrief(brief, now());
  let worksheet: Worksheet | undefined;

  const signal = options.signal ?? new AbortController().signal;
  const context = { lessonId: lesson.id, jobId: `eval-job-${brief.id}` };
  const deps: PipelineDeps = {
    ai: options.ai,
    budget: options.budget,
    signal,
    // Warnings reach the run's output: a schema miss logs its issue paths and messages
    // (content-free, ADR 0015) and nothing else, so a failed brief can be read from it. Info
    // records are read for one number — Verify's `durationMs` — and dropped.
    logger: pino(
      { level: "info" },
      new Writable({
        write(chunk, _encoding, callback) {
          const line = chunk.toString();
          const record = JSON.parse(line) as { level: number; msg?: string; durationMs?: number };
          if (record.msg === "facts verified" && typeof record.durationMs === "number") {
            verifyMs = record.durationMs;
          }
          if (record.level >= 40) process.stderr.write(line);
          callback();
        },
      }),
    ),
    now,
    ids: nextId,
    sources: noSources,
    persist: async (l, w) => {
      lesson = l;
      worksheet = w;
      if (firstSlideMs === null && l.slides.length > 0) firstSlideMs = Date.now() - startedAt;
      if (planMs === null && l.generation?.stage === "planned") planMs = Date.now() - startedAt;
      return { updatedAt: now().toISOString() };
    },
    onProgress: async () => undefined,
    context,
    ...(options.images ? { images: options.images } : {}),
    ...(options.planFrontierFromYear !== undefined
      ? { planFrontierFromYear: options.planFrontierFromYear }
      : {}),
  };

  let ok = true;
  let error: string | undefined;
  try {
    const final = await runLessonPipeline({ lesson }, deps);
    lesson = final.lesson;
    worksheet = final.worksheet;
  } catch (e) {
    ok = false;
    error =
      e instanceof StageFailure && e.reason === "timeout"
        ? "StageFailure:timeout"
        : e instanceof Error
          ? e.name
          : "Error";
  }
  // The lesson's own time: the judge that follows is measurement, not generation.
  const durationMs = Date.now() - startedAt;

  const after = options.budget.totals();
  const scored = ok
    ? await scoreLesson(
        brief.id,
        { lesson, worksheet },
        options.judge
          ? {
              ai: typeof options.judge === "object" ? options.judge : options.ai,
              budget: options.budget,
              signal,
              context,
            }
          : undefined,
      )
    : null;
  const afterJudge = options.budget.totals();
  const usd = (a: number | null, b: number | null) =>
    a === null || b === null ? null : Math.round((a - b) * 1e6) / 1e6;
  const findings = { error: 0, warning: 0, specRule: 0 };
  for (const f of lesson.generation?.findings ?? []) {
    findings[f.severity] += 1;
    if (f.check === SPEC_RULE_CHECK) findings.specRule += 1;
  }
  const result: BriefResult = {
    id: brief.id,
    ok,
    ...(error ? { error } : {}),
    durationMs,
    firstSlideMs,
    planMs,
    verifyMs,
    slides: lesson.slides.length,
    blocks: worksheet?.blocks.length ?? 0,
    calls: after.calls - before.calls,
    inputTokens: after.inputTokens - before.inputTokens,
    outputTokens: after.outputTokens - before.outputTokens,
    costUsd: usd(after.costUsd, before.costUsd),
    judge:
      ok && options.judge
        ? {
            calls: afterJudge.calls - after.calls,
            inputTokens: afterJudge.inputTokens - after.inputTokens,
            outputTokens: afterJudge.outputTokens - after.outputTokens,
            costUsd: usd(afterJudge.costUsd, after.costUsd),
          }
        : null,
    findings,
    scores: scored?.scores ?? null,
    ...(scored?.rubricRationales ? { rubricRationales: scored.rubricRationales } : {}),
  };
  return { result, lesson, worksheet };
}
