import { Writable } from "node:stream";
import { type Budget, createBudget } from "@tj/ai";
import { createFakeAi, type FakeAi, type FakeCall, type FakeScriptEntry } from "@tj/ai/testing";
import type { Finding, Lesson, Worksheet } from "@tj/domain/documents";
import { parseLesson } from "@tj/domain/documents";
import type { SlideSpec } from "@tj/slides";
import pino, { type Logger } from "pino";
import evaluateFixture from "./fixtures/evaluate.json";
import planFactsFixture from "./fixtures/plan-facts.json";
import planSkeletonFixture from "./fixtures/plan-skeleton.json";
import repairFixture from "./fixtures/repair.json";
import slidesFixture from "./fixtures/slides.json";
import verifyFixture from "./fixtures/verify.json";
import worksheetFixture from "./fixtures/worksheet.json";
import type { PlanFacts, PlanSkeleton, VerifyOutput, WorksheetSpec } from "./specs";
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
  verify: verifyFixture as VerifyOutput,
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

/** The input check's one answer (a clean brief), then Plan's three: skeleton, facts, verify. */
export const CHECK_INPUT_CALLS = 1;
export const PLAN_CALLS = 3;
/** Script index of the first Plan answer. */
export const PLAN_INDEX = CHECK_INPUT_CALLS;
/** Script index of the first slide answer. */
export const SLIDES_INDEX = CHECK_INPUT_CALLS + PLAN_CALLS;

/**
 * The script for one full run on the fixture plan: 1 check-input + 3 plan (skeleton, facts, verify) +
 * 8 slides + 1 worksheet (+ one illustrate judge per image-text slide, `judges`) + 1 evaluate
 * (+ repair answers when a test injects an `error` finding).
 * `overrides` replaces entries by index so a test can script a schema miss at a chosen call;
 * `checkInput` replaces the input check's answer.
 */
export function pipelineScript(
  options: {
    checkInput?: unknown;
    /** Verify's answer; the fixture's empty patch by default. */
    verify?: unknown;
    evaluate?: unknown;
    repairs?: number;
    /** Illustrate's judge answers, one per image-text slide, between the worksheet and evaluate. */
    judges?: FakeScriptEntry[];
    overrides?: Record<number, FakeScriptEntry>;
  } = {},
): FakeScriptEntry[] {
  const script: FakeScriptEntry[] = [
    json(options.checkInput ?? { findings: [] }),
    json(FIXTURES.planSkeleton),
    json(FIXTURES.planFacts),
    json(options.verify ?? FIXTURES.verify),
    ...fixtureSlideScript(),
    json(FIXTURES.worksheet),
    ...(options.judges ?? []),
    json(options.evaluate ?? { findings: [] }),
    ...Array.from({ length: options.repairs ?? 0 }, () => json(FIXTURES.repair)),
  ];
  for (const [index, entry] of Object.entries(options.overrides ?? {}))
    script[Number(index)] = entry;
  return script;
}

/**
 * Route a positional script for the parallel Generate (TEACH-213). Slide calls start in outline
 * order but a retry, or the worksheet call running alongside them, moves the call order away from
 * the list order, so entries are matched rather than counted: a `generate-worksheet` call takes the
 * first pending worksheet spec (a string or `FakeReply` whose JSON has `blocks`); a
 * `generate-slide` call for kind K takes the first pending entry that is either a scripted miss (a
 * non-JSON string, or any entry wrapped in `miss()` — consumed in list order, so a test's "bad
 * reply at slide n" lands on the next slide call) or a slide spec of kind K; every other call,
 * and any other function entry, is taken in list order. When nothing matches, the next entry is
 * taken as it always was.
 *
 * `pace` (milliseconds each answer waits before it is returned — for a watcher, not a unit test)
 * is applied here, after routing, so a paced entry is still matched by its shape.
 */
export function routed(
  script: FakeScriptEntry[],
  options: { pace?: number } = {},
): FakeScriptEntry[] {
  const pending = [...script];
  const textOf = (entry: FakeScriptEntry): string | undefined =>
    typeof entry === "string" ? entry : typeof entry === "function" ? undefined : entry.text;
  const parsed = (entry: FakeScriptEntry): Record<string, unknown> | undefined => {
    const text = textOf(entry);
    if (text === undefined) return undefined;
    try {
      const value = JSON.parse(text) as unknown;
      return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  const isMiss = (entry: FakeScriptEntry) =>
    (typeof entry === "function" && MISS in entry) ||
    (textOf(entry) !== undefined && parsed(entry) === undefined);
  const takeAt = (at: number) => (at === -1 ? pending.shift() : pending.splice(at, 1)[0]);
  const take = (call: FakeCall): FakeScriptEntry | undefined => {
    const version = call.context?.promptVersion ?? "";
    if (version.startsWith("generate-worksheet")) {
      return takeAt(pending.findIndex((e) => Array.isArray(parsed(e)?.blocks)));
    }
    if (version.startsWith("generate-slide")) {
      const kind = /kind "([a-z-]+)"/.exec(call.promptText)?.[1];
      return takeAt(
        pending.findIndex((e) => isMiss(e) || (kind !== undefined && parsed(e)?.kind === kind)),
      );
    }
    return pending.shift();
  };
  const pace = options.pace ?? 0;
  return script.map(() => async (call: FakeCall) => {
    const entry = take(call);
    if (pace > 0) await new Promise((resolve) => setTimeout(resolve, pace));
    if (entry === undefined) return "";
    return typeof entry === "function" ? entry(call) : entry;
  });
}

const MISS = Symbol("routed.miss");

/**
 * A scripted reply the routed fake hands to the next `generate-slide` call whatever its kind: for
 * a well-formed but wrong answer (a degenerate spec) that a test wants to land as a miss.
 */
export function miss(entry: FakeScriptEntry): FakeScriptEntry {
  const fn = async (call: FakeCall) => (typeof entry === "function" ? entry(call) : entry);
  return Object.assign(fn, { [MISS]: true });
}

/** `scriptedPipelineAi` with `entries` spliced in at `index` in place of the entry there. */
export function scriptedPipelineAiWithInserted(index: number, entries: FakeScriptEntry[]): FakeAi {
  const script = pipelineScript();
  script.splice(index, 1, ...entries);
  return createFakeAi({ script: routed(script), usage: { inputTokens: 1000, outputTokens: 400 } });
}

/** A fake answering the given entries only — e.g. a clean review for a resumed run. */
export function answeringAi(script: FakeScriptEntry[]): FakeAi {
  return createFakeAi({ script: routed(script), usage: { inputTokens: 1000, outputTokens: 400 } });
}

export function scriptedPipelineAi(
  options: Parameters<typeof pipelineScript>[0] & {
    usage?: { inputTokens: number; outputTokens: number };
    /** Milliseconds each answer waits before it is returned — for a watcher, not a unit test. */
    pace?: number;
  } = {},
): FakeAi {
  return createFakeAi({
    script: routed(pipelineScript(options), { pace: options.pace ?? 0 }),
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

/** A pino logger writing JSON lines into memory, so a test can assert what was — and was not — logged. */
export function memoryLogger(): { lines: string[]; logger: Logger } {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, logger: pino({ level: "info" }, destination) };
}
