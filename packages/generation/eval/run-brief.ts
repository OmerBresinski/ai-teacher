import type { Budget, CreatedAi } from "@tj/ai";
import { type Lesson, lessonFromBrief, type Worksheet } from "@tj/domain/documents";
import pino from "pino";
import { noSources, type PipelineDeps, runLessonPipeline } from "../src";
import type { EvalBrief } from "./briefs";
import { type EvalScores, scoreLesson } from "./scorers";

/*
 * One eval brief through the real pipeline (ADR 0025 §23), with the worker's `persist` contract
 * replaced by memory: every persist is counted and stamped, the first one carrying a slide gives
 * `firstSlideMs`. Nothing touches Postgres or storage. Shared by the schema half (scripted fake)
 * and the paid half (Bedrock); only `ai` and `budget` differ.
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
  /** `null` when the model id is unpriced (the token cap applied) or the run failed early. */
  costUsd: number | null;
  findings: { error: number; warning: number };
  scores: EvalScores | null;
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

  const deps: PipelineDeps = {
    ai: options.ai,
    budget: options.budget,
    signal: options.signal ?? new AbortController().signal,
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
    context: { lessonId: lesson.id, jobId: `eval-job-${brief.id}` },
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

  const after = options.budget.totals();
  const findings = { error: 0, warning: 0 };
  for (const f of lesson.generation?.findings ?? []) findings[f.severity] += 1;
  const result: BriefResult = {
    id: brief.id,
    ok,
    ...(error ? { error } : {}),
    durationMs: Date.now() - startedAt,
    firstSlideMs,
    slides: lesson.slides.length,
    blocks: worksheet?.blocks.length ?? 0,
    calls: after.calls - before.calls,
    inputTokens: after.inputTokens - before.inputTokens,
    outputTokens: after.outputTokens - before.outputTokens,
    costUsd:
      after.costUsd === null || before.costUsd === null
        ? null
        : Math.round((after.costUsd - before.costUsd) * 1e6) / 1e6,
    findings,
    scores: ok ? await scoreLesson(brief.id, { lesson, worksheet }) : null,
  };
  return { result, lesson, worksheet };
}
