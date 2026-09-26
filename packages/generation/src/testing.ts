import { Writable } from "node:stream";
import { type Budget, createBudget } from "@tj/ai";
import { createFakeAi, type FakeAi, type FakeCall, type FakeScriptEntry } from "@tj/ai/testing";
import type { Finding, Lesson, Worksheet } from "@tj/domain/documents";
import { parseLesson } from "@tj/domain/documents";
import { type MaterialiseMeta, materialiseBlock, type SlideSpec } from "@tj/slides";
import pino, { type Logger } from "pino";
import evaluateFixture from "./fixtures/evaluate.json";
import parseBriefFixture from "./fixtures/parse-brief.json";
import planFactsFixture from "./fixtures/plan-facts.json";
import planSkeletonApply from "./fixtures/plan-skeleton.apply.json";
import planSkeletonEvaluate from "./fixtures/plan-skeleton.evaluate.json";
import planSkeletonExplain from "./fixtures/plan-skeleton.explain.json";
import planSkeletonRecall from "./fixtures/plan-skeleton.recall.json";
import repairFixture from "./fixtures/repair.json";
import slidesFixture from "./fixtures/slides.json";
import verifyFixture from "./fixtures/verify.json";
import worksheetFixture from "./fixtures/worksheet.json";
import worksheetFillFixture from "./fixtures/worksheet-fill.json";
import { generateWorksheetPrompt, type ParseBriefFields, type WorksheetFill } from "./prompts";
import type { ObjectiveVerb } from "./shapes";
import type { PlanFacts, PlanSkeleton, VerifyOutput, WorksheetSpec } from "./specs";
import {
  noSources,
  type PhotoPlacer,
  type PipelineDeps,
  type PipelineStageName,
  type PipelineState,
} from "./types";

/*
 * Test helpers for the pipeline and its consumers (ADR 0025 §22): the fixtures as typed values,
 * a scripted fake that answers check-input → Plan (skeleton, facts, verify) → Generate×N →
 * Evaluate → Repair in order, the empty lesson `POST /lessons` creates, and a `PipelineDeps`
 * recorder. Network-free. The worksheet fixture stays for the worksheet job (ADR 0030) and the
 * proposal fakes; the lesson pipeline's script no longer carries it.
 */

/**
 * One skeleton fixture per objective verb (TEACH-229): the same states-of-matter lesson, positions
 * 0–6 identical (title, objectives, starter, vocabulary, content, content, worked-example) so the
 * one `plan-facts.json` fits every one of them, positions 7–9 written to the verb's shape — ten
 * entries, the `DEFAULT_SLIDE_COUNT` every brief gets, since the count is a shape rule (ADR 0029
 * item 9). Each
 * satisfies the shape of every eval brief with that verb; `eval:schema` picks by the brief's verb.
 * The Explain one satisfies all three confidences: it is also the e2e worker's script
 * (`apps/worker/src/fake-ai.ts`), and the brief screen pre-selects Explain / New to it.
 */
export const PLAN_SKELETONS: Record<ObjectiveVerb, PlanSkeleton> = {
  Recall: planSkeletonRecall as PlanSkeleton,
  Explain: planSkeletonExplain as PlanSkeleton,
  Apply: planSkeletonApply as PlanSkeleton,
  Evaluate: planSkeletonEvaluate as PlanSkeleton,
};

export const FIXTURES = {
  /** The default cell's skeleton (Explain / Some prior knowledge — what a brief without answers gets). */
  planSkeleton: PLAN_SKELETONS.Explain,
  planFacts: planFactsFixture as PlanFacts,
  slides: slidesFixture as Record<SlideSpec["kind"], SlideSpec>,
  worksheet: worksheetFixture as WorksheetSpec,
  /**
   * The fill call's answer for the knowledge-check frame built from the fixture facts (ADR 0030
   * item 3): its one slot, at index 3, takes three multiple-choice items that practise o1, o2 and
   * o3 from the pool (`q6`, `q13`, `q10`; easy, easy, stretch).
   */
  worksheetFill: worksheetFillFixture as WorksheetFill,
  /** `/briefs/parse`'s model half when the rules found the year group and minutes (TEACH-16). */
  parseBrief: parseBriefFixture as ParseBriefFields,
  evaluate: evaluateFixture as { findings: Finding[] },
  repair: repairFixture as SlideSpec,
  verify: verifyFixture as VerifyOutput,
} as const;

export const SAMPLE_LESSON_ID = "0192f7a0-0000-7000-8000-000000000042";
export const SAMPLE_JOB_ID = "0192f7a0-0000-7000-8000-0000000000aa";

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
export function fixtureSlideScript(skeleton: PlanSkeleton = FIXTURES.planSkeleton): string[] {
  return skeleton.outline.slice(2).map((entry) => json(FIXTURES.slides[entry.kind]));
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
 * 8 slides (+ one illustrate judge per image-text slide, `judges`) + 1 evaluate
 * (+ repair answers when a test injects an `error` finding).
 * `overrides` replaces entries by index so a test can script a schema miss at a chosen call;
 * `checkInput` replaces the input check's answer.
 */
export function pipelineScript(
  options: {
    checkInput?: unknown;
    /** The skeleton answer (and the slide answers that follow it); the default cell's by default. */
    skeleton?: PlanSkeleton;
    /** Verify's answer; the fixture's empty patch by default. */
    verify?: unknown;
    evaluate?: unknown;
    repairs?: number;
    /** Illustrate's judge answers, one per image-text slide, between the slides and evaluate. */
    judges?: FakeScriptEntry[];
    overrides?: Record<number, FakeScriptEntry>;
  } = {},
): FakeScriptEntry[] {
  const skeleton = options.skeleton ?? FIXTURES.planSkeleton;
  const script: FakeScriptEntry[] = [
    json(options.checkInput ?? { findings: [] }),
    json(skeleton),
    json(FIXTURES.planFacts),
    json(options.verify ?? FIXTURES.verify),
    ...fixtureSlideScript(skeleton),
    ...(options.judges ?? []),
    json(options.evaluate ?? { findings: [] }),
    ...Array.from({ length: options.repairs ?? 0 }, () => json(FIXTURES.repair)),
  ];
  for (const [index, entry] of Object.entries(options.overrides ?? {}))
    script[Number(index)] = entry;
  return script;
}

/**
 * The script for one `lesson.worksheet` run (ADR 0030 item 3): the fill answer, then a block
 * repair answer per `repairs` (the first fill block as a spec; `routed` hands it to the repair
 * call in list order). `fill` replaces the fixture answer, e.g. with a scripted miss.
 */
export function worksheetScript(
  options: { fill?: FakeScriptEntry; repairs?: number } = {},
): FakeScriptEntry[] {
  const repair = FIXTURES.worksheetFill.slots[0]?.blocks[0];
  return [
    options.fill ?? json(FIXTURES.worksheetFill),
    ...Array.from({ length: options.repairs ?? 0 }, () => json(repair)),
  ];
}

/** A fake answering `worksheetScript`, routed like `scriptedPipelineAi`. */
export function scriptedWorksheetAi(
  options: Parameters<typeof worksheetScript>[0] & {
    usage?: { inputTokens: number; outputTokens: number };
    pace?: number;
  } = {},
): FakeAi {
  return createFakeAi({
    script: routed(worksheetScript(options), { pace: options.pace ?? 0 }),
    usage: options.usage ?? { inputTokens: 1000, outputTokens: 400 },
  });
}

/**
 * Route a positional script for the parallel Generate (TEACH-213). Slide calls start in outline
 * order but a retry, or Verify running alongside them, moves the call order away from the list
 * order, so entries are matched rather than counted: a `generate-worksheet-fill` call (the
 * worksheet job, TEACH-14) takes the first pending fill answer (JSON with `slots`); a
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
    // The fill call (ADR 0030 item 3) answers per slot; it must not take a whole-sheet spec.
    if (version.startsWith("generate-worksheet-fill")) {
      return takeAt(pending.findIndex((e) => Array.isArray(parsed(e)?.slots)));
    }
    // The photo judge runs inside Generate alongside the slide calls (TEACH-220), so its reply is
    // found by shape too, not by position.
    if (version.startsWith("pick-or-requery-photo")) {
      return takeAt(pending.findIndex((e) => "pick" in (parsed(e) ?? {})));
    }
    // Verify runs alongside the first slide batch (TEACH-233): its reply is found by shape too. A
    // scripted miss for it (a non-JSON entry right where the verify answer sits) is still taken in
    // list order by the fallthrough below.
    if (version.startsWith("verify-facts")) {
      const at = pending.findIndex((e) => Array.isArray(parsed(e)?.corrections));
      if (at !== -1) return takeAt(at);
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
  progress: {
    percent: number;
    message: string;
    stage: PipelineStageName;
    documentUpdatedAt: string | undefined;
  }[];
  abort: AbortController;
}

/** Stage-control tests refuse the N+1st reservation deterministically; @tj/ai tests real USD races. */
export function callLimitedBudget(maxCalls: number): Budget {
  const real = createBudget({ capUsd: 1000, capTokens: 100_000_000 });
  let admitted = 0;
  return {
    ...real,
    reserve(modelId, estimate) {
      if (admitted >= maxCalls) return { by: "usd" };
      const result = real.reserve(modelId, estimate);
      if ("reservation" in result) admitted++;
      return result;
    },
    exceeded: () => (admitted >= maxCalls ? { by: "usd" } : real.exceeded()),
  };
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
    onProgress: async (percent, message, stage, documentUpdatedAt) => {
      progress.push({ percent, message, stage, documentUpdatedAt });
    },
    context: { lessonId: SAMPLE_LESSON_ID, jobId: SAMPLE_JOB_ID },
    images: options.images,
    persisted,
    progress,
    abort,
  };
}

export function initialState(lesson: Lesson = sampleBriefLesson()): PipelineState {
  return { lesson };
}

/**
 * A worksheet written the way Generate wrote one before ADR 0030 (a whole-sheet spec, the
 * lesson's audience, `lessonId`), for the Evaluate and Repair tests over a legacy lesson whose
 * sheet still rides in `PipelineState.worksheet`. Test-only since TEACH-14; the worksheet job
 * frames from a recipe (`src/worksheet/frame.ts`).
 */
export function legacyWorksheet(
  spec: WorksheetSpec,
  modelId: string,
  lesson: Lesson,
  worksheetId: string,
  deps: Pick<PipelineDeps, "now" | "ids">,
): Worksheet {
  const at = deps.now().toISOString();
  const blockMeta: MaterialiseMeta = {
    promptVersion: generateWorksheetPrompt.version,
    model: modelId,
    at,
  };
  const worksheet: Worksheet = {
    version: 1,
    id: worksheetId,
    title: spec.title,
    themeId: lesson.themeId,
    createdAt: at,
    updatedAt: at,
    header: {
      showName: true,
      showDate: true,
      showClass: true,
      title: spec.title,
      subtitle: spec.subtitle,
      criteria: spec.criteria.length > 0 ? spec.criteria.slice(0, 4) : undefined,
    },
    blocks: spec.blocks.map((block) => materialiseBlock(block, blockMeta, deps.ids)),
    includeAnswerKey: true,
    pageSize: "A4",
    ageBand: lesson.ageBand,
    yearGroup: lesson.yearGroup,
    subject: lesson.subject,
    readingLevel: lesson.readingLevel,
    language: lesson.language,
    lessonId: lesson.id,
  };
  return JSON.parse(JSON.stringify(worksheet)) as Worksheet;
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

export * from "./planner/testing";
