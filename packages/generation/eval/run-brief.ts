import type { Budget, CreatedAi } from "@tj/ai";
import { type Lesson, lessonFromBrief, type Worksheet } from "@tj/domain/documents";
import pino from "pino";
import { noSources, type PipelineDeps, runLessonPipeline } from "../src";
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
  /** The stage's error name when `ok` is false — never its message (it may echo the brief). */
  error?: string;
  durationMs: number;
  /** Time to the first persisted lesson with at least one slide; `null` when none arrived. */
  firstSlideMs: number | null;
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
  findings: { error: number; warning: number };
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
  /** Score the rubric with the `frontier` judge on the same `ai` and `budget` (the paid half only). */
  judge?: boolean;
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
  let lesson = lessonForBrief(brief, now());
  let worksheet: Worksheet | undefined;

  const signal = options.signal ?? new AbortController().signal;
  const context = { lessonId: lesson.id, jobId: `eval-job-${brief.id}` };
  const deps: PipelineDeps = {
    ai: options.ai,
    budget: options.budget,
    signal,
    logger: pino({ level: "silent" }),
    now,
    ids: nextId,
    sources: noSources,
    persist: async (l, w) => {
      lesson = l;
      worksheet = w;
      if (firstSlideMs === null && l.slides.length > 0) firstSlideMs = Date.now() - startedAt;
      return { updatedAt: now().toISOString() };
    },
    onProgress: async () => undefined,
    context,
  };

  let ok = true;
  let error: string | undefined;
  try {
    const final = await runLessonPipeline({ lesson, worksheetId: `eval-${brief.id}-ws` }, deps);
    lesson = final.lesson;
    worksheet = final.worksheet;
  } catch (e) {
    ok = false;
    error = e instanceof Error ? e.name : "Error";
  }
  // The lesson's own time: the judge that follows is measurement, not generation.
  const durationMs = Date.now() - startedAt;

  const after = options.budget.totals();
  const scored = ok
    ? await scoreLesson(
        brief.id,
        { lesson, worksheet },
        options.judge ? { ai: options.ai, budget: options.budget, signal, context } : undefined,
      )
    : null;
  const afterJudge = options.budget.totals();
  const usd = (a: number | null, b: number | null) =>
    a === null || b === null ? null : Math.round((a - b) * 1e6) / 1e6;
  const findings = { error: 0, warning: 0 };
  for (const f of lesson.generation?.findings ?? []) findings[f.severity] += 1;
  const result: BriefResult = {
    id: brief.id,
    ok,
    ...(error ? { error } : {}),
    durationMs,
    firstSlideMs,
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
