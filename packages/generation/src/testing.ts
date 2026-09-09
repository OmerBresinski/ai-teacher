import { type Budget, createBudget } from "@tj/ai";
import { createFakeAi, type FakeAi, type FakeScriptEntry } from "@tj/ai/testing";
import type { Finding, Lesson, Worksheet } from "@tj/domain/documents";
import { parseLesson } from "@tj/domain/documents";
import type { SlideSpec } from "@tj/slides";
import pino from "pino";
import evaluateFixture from "./fixtures/evaluate.json";
import planFactsFixture from "./fixtures/plan-facts.json";
import planSkeletonFixture from "./fixtures/plan-skeleton.json";
import repairFixture from "./fixtures/repair.json";
import slidesFixture from "./fixtures/slides.json";
import worksheetFixture from "./fixtures/worksheet.json";
import type { PlanFacts, PlanSkeleton, WorksheetSpec } from "./specs";
import { noSources, type PhotoPlacer, type PipelineDeps, type PipelineState } from "./types";

/*
 * Test helpers for the pipeline and its consumers (ADR 0025 §22): the fixtures as typed values,
 * a scripted fake that answers check-input → Plan (skeleton, facts) → Generate×N → worksheet →
 * Evaluate → Repair in order, the
 * empty lesson `POST /lessons` creates, and a `PipelineDeps` recorder. Network-free.
 */

export const FIXTURES = {
  planSkeleton: planSkeletonFixture as PlanSkeleton,
  planFacts: planFactsFixture as PlanFacts,
  slides: slidesFixture as Record<SlideSpec["kind"], SlideSpec>,
  worksheet: worksheetFixture as WorksheetSpec,
  evaluate: evaluateFixture as { findings: Finding[] },
  repair: repairFixture as SlideSpec,
} as const;

export const SAMPLE_LESSON_ID = "0192f7a0-0000-7000-8000-000000000042";
export const SAMPLE_JOB_ID = "0192f7a0-0000-7000-8000-0000000000aa";
export const SAMPLE_WORKSHEET_ID = "0192f7a0-0000-7000-8000-0000000000ee";

/** The lesson exactly as `POST /lessons` writes it (`lessonFromBrief`): a brief, no slides. */
export function sampleBriefLesson(patch: Partial<Lesson> = {}): Lesson {
  return parseLesson({
    version: 1,
    id: SAMPLE_LESSON_ID,
    title: "States of matter",
    themeId: "chalk",
    slides: [],
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    subject: "Science",
    yearGroup: "Year 8",
    ageBand: "ks3",
    language: "en-GB",
    brief: { topic: "States of matter and the particle model", durationMin: 60 },
    ...patch,
  });
}

const json = (value: unknown) => JSON.stringify(value);

/** The slide answers for the fixture plan's outline entries after `title` and `objectives`. */
export function fixtureSlideScript(): string[] {
  return FIXTURES.planSkeleton.outline.slice(2).map((entry) => json(FIXTURES.slides[entry.kind]));
}

/** The input check's one answer (a clean brief), then Plan's two: the skeleton, then the facts. */
export const CHECK_INPUT_CALLS = 1;
export const PLAN_CALLS = 2;
/** Script index of the first Plan answer. */
export const PLAN_INDEX = CHECK_INPUT_CALLS;
/** Script index of the first slide answer. */
export const SLIDES_INDEX = CHECK_INPUT_CALLS + PLAN_CALLS;

/**
 * The script for one full run on the fixture plan: 1 check-input + 2 plan (skeleton, facts) +
 * 8 slides + 1 worksheet (+ one illustrate judge per image-text slide, `judges`) + 1 evaluate
 * (+ repair answers when a test injects an `error` finding).
 * `overrides` replaces entries by index so a test can script a schema miss at a chosen call;
 * `checkInput` replaces the input check's answer.
 */
export function pipelineScript(
  options: {
    checkInput?: unknown;
    evaluate?: unknown;
    repairs?: number;
    /** Illustrate's judge answers, one per image-text slide, between the worksheet and evaluate. */
    judges?: FakeScriptEntry[];
    overrides?: Record<number, FakeScriptEntry>;
    /** Milliseconds each answer waits before it is returned — for a watcher, not a unit test. */
    pace?: number;
  } = {},
): FakeScriptEntry[] {
  const script: FakeScriptEntry[] = [
    json(options.checkInput ?? { findings: [] }),
    json(FIXTURES.planSkeleton),
    json(FIXTURES.planFacts),
    ...fixtureSlideScript(),
    json(FIXTURES.worksheet),
    ...(options.judges ?? []),
    json(options.evaluate ?? { findings: [] }),
    ...Array.from({ length: options.repairs ?? 0 }, () => json(FIXTURES.repair)),
  ];
  for (const [index, entry] of Object.entries(options.overrides ?? {}))
    script[Number(index)] = entry;
  const pace = options.pace ?? 0;
  return pace > 0 ? script.map((entry) => paced(entry, pace)) : script;
}

const paced =
  (entry: FakeScriptEntry, ms: number): FakeScriptEntry =>
  async (call) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return typeof entry === "function" ? entry(call) : entry;
  };

/** `scriptedPipelineAi` with `entries` spliced in at `index` in place of the entry there. */
export function scriptedPipelineAiWithInserted(index: number, entries: FakeScriptEntry[]): FakeAi {
  const script = pipelineScript();
  script.splice(index, 1, ...entries);
  return createFakeAi({ script, usage: { inputTokens: 1000, outputTokens: 400 } });
}

/** A fake answering the given entries only — e.g. a clean review for a resumed run. */
export function answeringAi(script: FakeScriptEntry[]): FakeAi {
  return createFakeAi({ script, usage: { inputTokens: 1000, outputTokens: 400 } });
}

export function scriptedPipelineAi(
  options: Parameters<typeof pipelineScript>[0] & {
    usage?: { inputTokens: number; outputTokens: number };
  } = {},
): FakeAi {
  return createFakeAi({
    script: pipelineScript(options),
    usage: options.usage ?? { inputTokens: 1000, outputTokens: 400 },
  });
}

export interface RecordedDeps extends PipelineDeps {
  ai: FakeAi;
  persisted: { lesson: Lesson; worksheet: Worksheet | undefined; updatedAt: string }[];
  progress: { percent: number; message: string; documentUpdatedAt: string | undefined }[];
  abort: AbortController;
}

/** `PipelineDeps` over a fake with a recording `persist` / `onProgress` and a counting `ids`. */
export function recordingDeps(
  ai: FakeAi,
  options: {
    budget?: Budget;
    logger?: pino.Logger;
    abortAfterPersist?: number;
    images?: PhotoPlacer;
  } = {},
): RecordedDeps {
  const abort = new AbortController();
  const persisted: RecordedDeps["persisted"] = [];
  const progress: RecordedDeps["progress"] = [];
  let tick = 0;
  let n = 0;
  return {
    ai,
    budget: options.budget ?? createBudget({ capUsd: 5, capTokens: 5_000_000 }),
    signal: abort.signal,
    logger: options.logger ?? pino({ level: "silent" }),
    now: () => new Date(Date.UTC(2026, 8, 6, 10, 0, tick++)),
    ids: () => `e${++n}`,
    sources: noSources,
    persist: async (lesson, worksheet) => {
      const updatedAt = new Date(Date.UTC(2026, 8, 6, 11, 0, persisted.length)).toISOString();
      persisted.push({ lesson, worksheet, updatedAt });
      if (
        options.abortAfterPersist !== undefined &&
        persisted.length >= options.abortAfterPersist
      ) {
        abort.abort(new DOMException("cancelled", "AbortError"));
      }
      return { updatedAt };
    },
    onProgress: async (percent, message, documentUpdatedAt) => {
      progress.push({ percent, message, documentUpdatedAt });
    },
    context: { lessonId: SAMPLE_LESSON_ID, jobId: SAMPLE_JOB_ID },
    images: options.images,
    persisted,
    progress,
    abort,
  };
}

export function initialState(lesson: Lesson = sampleBriefLesson()): PipelineState {
  return { lesson, worksheetId: SAMPLE_WORKSHEET_ID };
}
