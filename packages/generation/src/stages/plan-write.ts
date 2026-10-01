import { safeError } from "@tj/domain";
import {
  DEFAULT_SLIDE_COUNT,
  type FactQuestion,
  type Finding,
  type ImageBrief,
  type KeyIdea,
  type Lesson,
  type LessonFacts,
  type OutlineEntry,
  type RetrievalQuestion,
  type Slide,
  type VocabularyItem,
  type WorkedExample,
} from "@tj/domain/documents";
import {
  FIT_VERSION,
  fitsPlanned,
  getTheme,
  type MaterialiseMeta,
  materialiseSlide,
  PLACEHOLDER_IMAGE,
  withDiagramDrawn,
  withoutPicture,
} from "@tj/slides";
import { z } from "zod";
import { callStructured } from "../call";
import { blocking, checkPlan, FIXED_SLIDES, type PlanCheck } from "../plan-write/check";
import {
  fitWithRewrite,
  fitWritten,
  renderWritten,
  type Written,
  withSetTag,
} from "../plan-write/fit";
import { contractFor, isSetForm, planMenu, slideWriterSchema } from "../plan-write/menu";
import { recheckKinds } from "../plan-write/recheck";
import {
  answerKeyMismatches,
  broadenedBrief,
  CHECK_GROUP_MAX,
  checkBatcher,
  crossSlideFindings,
  fieldOfEvidence,
  isSmallForCheck,
  NO_PICTURE_ROW,
  noPictureOf,
  PICTURE_FORMS,
  SLIDE_CHECK_CONCURRENCY,
  skipsCheck,
} from "../plan-write/slide-check";
import { PLAN_WRITE_VERSION, STREAM_WRITE_VERSION } from "../plan-write/steps";
import {
  checkStreamed,
  kindOf,
  planWriteMode,
  type StreamLessonWire,
  streamLessonLenient,
  streamLessonSchema,
  streamSlideSchema,
} from "../plan-write/stream";
import { CODE_MODEL, withAnswersReveal } from "../planner/coded-slides";
import { verifyFactsPrompt } from "../prompts";
import {
  MASTER_CHECK_KINDS,
  MASTER_CHECK_VERSION,
  type MasterCheckInput,
  masterCheckPrompt,
} from "../prompts/master-check";
import {
  PLAN_LESSON_VERSION,
  type PlanLessonInput,
  type PlanLessonWire,
  type PlanSlide,
  parsePlan,
  planLessonPrompt,
  planLessonSchema,
  planTableSchema,
} from "../prompts/plan-lesson";
import {
  STREAM_LESSON_VERSION,
  type StreamLessonInput,
  streamLessonPrompt,
} from "../prompts/stream-lesson";
import {
  WRITE_SLIDES_VERSION,
  type WriteSlidesInput,
  type WriteSlideTarget,
  writeSlidesPrompt,
} from "../prompts/write-slides";
import {
  BudgetExceeded,
  callContext,
  type PipelineDeps,
  type PipelineState,
  StageFailure,
  throwIfAborted,
} from "../types";
import { VERIFY_EFFORT } from "./designer";
import { evaluateSlides } from "./evaluate";
import { withUsage } from "./generate";
import { joinVersions, type PlacedPhoto, pickPhoto, plainSubject, withPhoto } from "./illustrate";
import { existingTitle, materialiseTitle } from "./plan";
import { audienceOf, BUDGET_FINDING, generationOf, planClassFor } from "./shared";
import { runVerify } from "./verify";

/** The title variants that carry a photograph, in the order drawTitle tries them. */
const TITLE_PICTURE_ORDER = ["split", "photo-band", "photo-band-long"] as const;

/*
 * Plan-write's two steps (spike/plan-write). `planWritePlan`: the title saved before any call, one
 * planner call designs the whole lesson as a slide table, the code check (`checkPlan`) with at most
 * one repair call, and the objectives and checked table saved as `planned`. `planWriteSlides`: the
 * title redrawn with the objectives, the other slides written by parallel writer calls (2–3 slides
 * each, each seeing the whole table), each slide rendered and fitted with one re-write of a failing
 * field, saved in slide order as they land; then photos and Verify as the designer runs them.
 */

const PROGRESS_STARTING = 2;
const PROGRESS_PLANNED = 10;
const PROGRESS_SLIDES_FROM = 10;
const PROGRESS_SLIDES_SPAN = 70;
const PROGRESS_GENERATED = PROGRESS_SLIDES_FROM + PROGRESS_SLIDES_SPAN;

export const MAX_OUTPUT_TOKENS_PLAN = 16000;
export const WRITER_OUTPUT_TOKENS_BASE = 1500;
export const WRITER_OUTPUT_TOKENS_PER_SLIDE = 1500;
const MAX_OUTPUT_TOKENS_REWRITE = 2000;
const MAX_OUTPUT_TOKENS_MASTER_CHECK = 3000;
/** At most this many master-check fixes are applied, in the order the checker gave them. */
const MASTER_CHECK_MAX_FIXES = 6;
const masterCheckSchema = z.object({
  fixes: z.array(
    z.object({
      slide: z.number().int(),
      field: z.string(),
      kind: z.enum(MASTER_CHECK_KINDS),
      problem: z.string(),
    }),
  ),
});
/** The single stream: the plan header and every slide in one answer. */
export const MAX_OUTPUT_TOKENS_STREAM = 16000;
/** Slides per writer call. */
export const WRITER_BATCH = 3;

/** The saved slide table: the checked plan and what the check did. */
export const SlidePlanRecordSchema = z.object({
  plan: planTableSchema,
  switched: z.array(
    z.object({ slide: z.number(), form: z.string(), from: z.string(), to: z.string() }),
  ),
  problems: z.array(
    z.object({ rule: z.string(), slide: z.number().optional(), message: z.string() }),
  ),
  repaired: z.boolean(),
  /** Diagram slots' specs by slide number, for the diagram renderer (spike/diagrams). */
  diagrams: z.record(z.string(), z.unknown()).optional(),
});
export type SlidePlanRecord = z.infer<typeof SlidePlanRecordSchema>;

/** Contiguous writer batches over slide numbers, as even as `size` allows (7 → 3, 2, 2). */
export function batchesOf(numbers: readonly number[], size = WRITER_BATCH): number[][] {
  if (numbers.length === 0) return [];
  const count = Math.ceil(numbers.length / size);
  const out: number[][] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const take = Math.ceil((numbers.length - at) / (count - i));
    out.push(numbers.slice(at, at + take));
    at += take;
  }
  return out;
}

const asPrompt = <I>(version: string, built: { system: string; user: string }) => ({
  version,
  system: built.system,
  user: (_: I) => built.user,
});

/* ------------------------------------------------------------------ plan */

type Objectives = LessonFacts["objectives"];

/** The facts a checked plan saves: the objectives, the misconception and the slide table. */
function plannedFacts(
  record: SlidePlanRecord,
  objectives: Objectives,
  durationMin: LessonFacts["durationMin"],
): LessonFacts {
  return {
    objectives,
    vocabulary: [],
    workedExamples: [],
    questions: [],
    misconceptions: [
      {
        id: "m1",
        belief: record.plan.misconception,
        correction: "",
        objectiveRefs: objectives.map((o) => o.id),
      },
    ],
    outline: [],
    durationMin,
    slidePlan: record as unknown as Record<string, unknown>,
  };
}

export async function planWritePlan(
  state: PipelineState,
  deps: PipelineDeps,
): Promise<PipelineState> {
  let lesson = state.lesson;
  const brief = lesson.brief;
  if (!brief) throw new Error("plan-write: the lesson has no brief");
  const startedAt = new Date(deps.now()).toISOString();
  if (!existingTitle(lesson)) {
    const { generation: _none, ...bare } = lesson;
    lesson = { ...bare, slides: [materialiseTitle(bare, deps)] };
    const { updatedAt } = await deps.persist(lesson);
    await deps.onProgress(PROGRESS_STARTING, "Title ready", "plan", updatedAt);
  }
  // The stream plans and writes in one call, in the write step.
  if (planWriteMode() === "stream") return { ...state, lesson };
  const slideCount = brief.slideCount ?? DEFAULT_SLIDE_COUNT;
  const menu = planMenu(lesson.subject);
  const cls = planClassFor(lesson, deps);
  const input: PlanLessonInput = {
    topic: brief.topic,
    audience: audienceOf(lesson),
    ...(brief.answers ? { answers: brief.answers } : {}),
    ...(brief.classContext?.priorKnowledge
      ? { priorKnowledge: brief.classContext.priorKnowledge }
      : {}),
    slideCount,
    menu,
  };
  const callPlan = async (i: PlanLessonInput): Promise<PlanLessonWire> => {
    deps.logger.info(
      { stage: "plan", call: "plan-lesson", repair: i.repair !== undefined },
      "plan call",
    );
    const call = await callStructured({
      deps,
      stage: "plan",
      cls,
      effort: "low",
      prompt: asPrompt<PlanLessonInput>(PLAN_LESSON_VERSION, planLessonPrompt(i)),
      input: i,
      schema: planLessonSchema,
      maxOutputTokens: MAX_OUTPUT_TOKENS_PLAN,
    });
    return call.output as PlanLessonWire;
  };
  /** The rows as the table, checked; a row not in the format is one more problem. */
  const check = (wire: PlanLessonWire): PlanCheck => {
    const { plan, unreadable } = parsePlan(wire);
    const c = checkPlan(plan, { slideCount, menu });
    const rows = unreadable.map((n) => ({
      rule: "form" as const,
      slide: n,
      message: `Row for slide ${n} is not 8 fields split by " | ".`,
    }));
    return { ...c, problems: [...rows, ...c.problems] };
  };

  let checked: PlanCheck = check(await callPlan(input));
  let repaired = false;
  if (checked.problems.length > 0) {
    deps.logger.info(
      { stage: "plan", problems: checked.problems },
      "plan check failed; one repair",
    );
    const again = check(
      await callPlan({
        ...input,
        repair: { previous: checked.plan, problems: checked.problems.map((p) => p.message) },
      }),
    );
    // The repaired plan stands unless it breaks more of the rules the write step needs.
    if (blocking(again.problems).length <= blocking(checked.problems).length) {
      checked = again;
      repaired = true;
    }
  }
  const stops = blocking(checked.problems);
  if (stops.length > 0) {
    throw new StageFailure(
      "plan",
      `plan-write: the plan breaks ${stops.map((p) => p.message).join(" ")}`,
    );
  }
  if (checked.problems.length > 0) {
    deps.logger.warn({ stage: "plan", problems: checked.problems }, "plan written with problems");
  }
  const plan = checked.plan;
  const objectives =
    state.pinObjectives && (lesson.facts?.objectives.length ?? 0) > 0
      ? (lesson.facts?.objectives ?? [])
      : plan.objectives.map((text, i) => ({ id: `o${i + 1}`, text }));
  const record: SlidePlanRecord = {
    plan,
    switched: checked.switched,
    problems: checked.problems,
    repaired,
  };
  const facts = plannedFacts(record, objectives, brief.durationMin);
  const planned: Lesson = {
    ...lesson,
    facts,
    generation: {
      jobId: deps.context.jobId,
      stage: "planned",
      startedAt,
      promptVersions: { planned: PLAN_WRITE_VERSION },
      usage: deps.budget.totals(),
      findings: [],
    },
  };
  const { updatedAt } = await deps.persist(planned);
  await deps.onProgress(PROGRESS_PLANNED, "Planned", "plan", updatedAt);
  deps.logger.info(
    { stage: "plan", switched: checked.switched, repaired, problems: checked.problems.length },
    "plan-write plan",
  );
  return { ...state, lesson: planned };
}

/* ------------------------------------------------------------------ facts from written slides */

type Placed = { index: number; plan: PlanSlide; out: Written };

const flat = (v: unknown): string =>
  typeof v === "string"
    ? v
    : Array.isArray(v)
      ? v.map(flat).join(" ")
      : v && typeof v === "object"
        ? Object.values(v).map(flat).join(" ")
        : "";

type SlideFacts = {
  keyIdeas: KeyIdea[];
  questions: FactQuestion[];
  workedExamples: WorkedExample[];
  vocabulary: VocabularyItem[];
  retrieval: RetrievalQuestion[];
};

/** A written slide's material as facts, so Verify, Evaluate and Repair read what the slide says. */
export function factsOfWritten(
  form: string,
  out: Written,
  objectiveRefs: string[],
  next: (prefix: string) => string,
): SlideFacts {
  const f: SlideFacts = {
    keyIdeas: [],
    questions: [],
    workedExamples: [],
    vocabulary: [],
    retrieval: [],
  };
  const o = out as Record<string, unknown>;
  const text = (v: unknown) => flat(v).trim();
  switch (form) {
    case "worked-example": {
      const steps = (o.steps ?? []) as string[];
      f.workedExamples.push({
        id: next("x"),
        problem: text(o.question),
        steps,
        answer: steps[steps.length - 1] ?? "",
        objectiveRefs,
      });
      break;
    }
    case "hinge": {
      const options = (o.options ?? []) as { text: string; correct: boolean }[];
      f.questions.push({
        id: next("q"),
        stem: text(o.stem),
        answer: options.find((x) => x.correct)?.text ?? "",
        reasoning: text(o.explanation),
        objectiveRefs,
        distractors: options.filter((x) => !x.correct).map((x) => ({ text: x.text })),
        use: "slide",
      });
      break;
    }
    case "true-false":
      f.questions.push({
        id: next("q"),
        stem: text(o.statement),
        answer: o.correct ? "True" : "False",
        reasoning: text(o.explanation),
        objectiveRefs,
        use: "slide",
      });
      break;
    case "open-response":
      f.questions.push({
        id: next("q"),
        stem: text(o.stem),
        answer: text(o.modelAnswer),
        reasoning: "",
        objectiveRefs,
        use: "slide",
      });
      break;
    case "vocabulary":
      for (const e of (o.entries ?? []) as { term: string; definition: string }[]) {
        f.vocabulary.push({ id: next("v"), term: e.term, definition: e.definition, objectiveRefs });
      }
      break;
    case "starter-set":
      for (const q of (o.questions ?? []) as { question: string; answer: string }[]) {
        f.retrieval.push({ question: q.question, answer: q.answer });
      }
      break;
    case "check-set":
    case "exit-ticket":
      for (const q of (o.questions ?? []) as { question: string; answer: string }[]) {
        f.questions.push({
          id: next("q"),
          stem: q.question,
          answer: q.answer,
          reasoning: "",
          objectiveRefs,
          use: form === "exit-ticket" ? "exit" : "slide",
        });
      }
      break;
    case "explain":
    case "explain-callout":
    case "list":
    case "compare":
    case "sequence":
    case "photo":
    case "figure":
    case "diagram-slot": {
      const { heading, notes: _n, imageBrief: _i, ...rest } = o;
      f.keyIdeas.push({
        id: next("k"),
        statement: text(heading),
        explanation: text(rest),
        example: "",
        objectiveRefs,
      });
      break;
    }
    default:
      break;
  }
  return f;
}

/** Every string in a written slide with `from` replaced by `to` (a Verify correction). */
export function replaced(out: Written, from: string, to: string): Written {
  const walk = (v: unknown): unknown =>
    typeof v === "string"
      ? v.split(from).join(to)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return walk(out) as Written;
}

/** Changed strings between two versions of the facts, by fact id: `[id, before, after]`. */
function changedStrings(before: LessonFacts, after: LessonFacts): [string, string, string][] {
  const byId = (f: LessonFacts) =>
    new Map<string, unknown>(
      [...(f.keyIdeas ?? []), ...f.questions, ...f.workedExamples, ...f.vocabulary].map((x) => [
        x.id,
        x,
      ]),
    );
  const a = byId(before);
  const out: [string, string, string][] = [];
  for (const [id, fresh] of byId(after)) {
    const old = a.get(id) as Record<string, unknown> | undefined;
    if (!old) continue;
    for (const [k, v] of Object.entries(fresh as Record<string, unknown>)) {
      if (typeof v === "string" && typeof old[k] === "string" && old[k] !== v && old[k] !== "") {
        out.push([id, old[k] as string, v]);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ write */

export type PlanWriteReport = {
  slideCount: number;
  switched: SlidePlanRecord["switched"];
  planProblems: number;
  repaired: boolean;
  slides: {
    slide: number;
    form: string;
    layout: string;
    fits: boolean;
    rewritten?: { field: string; failure: string; ok: boolean };
    /** A hinge that did not fit, re-planned as another check ("hinge -> true-false"). */
    rechecked?: string;
    /** A picture slide whose picture could not be filled, drawn with the text full width. */
    noPicture?: boolean;
  }[];
  mode: "plan-write" | "stream";
  requested: number;
  delivered: number;
  /** Slides that fit with no re-write. */
  fitFirstTime: number;
  /** Stream only: when the plan header closed, and when each slide closed (ms from the start). */
  streamHeaderMs?: number;
  streamSlidesMs?: Record<number, number>;
  failedBatches: number[][];
  firstSlideMs?: number;
  editableMs: number;
  verify: { corrections: number; refitted: number; rejected: number };
  photos: { requested: number; placed: number };
  /**
   * Stream (spike/parallel-slides): each slide's check, started as it closed (ms from the start):
   * Verify corrections, findings kept, fields re-written, and whether the checked slide was saved.
   */
  checks?: Record<
    number,
    {
      startMs: number;
      endMs: number;
      corrections: number;
      findings: number;
      rewrites: string[];
      saved: boolean;
    }
  >;
  /** When each slide's photo search ended (ms from the start), how, and whether it was retried. */
  photoReady?: Record<number, { ms: number; outcome: string; retried: boolean }>;
  /** Slides whose picture or drawing could not be filled, drawn with the text full width. */
  noPicture?: number[];
  checksDoneMs?: number;
  photosDoneMs?: number;
  /** Faults the lesson-level pass found (taught before tested, one hinge, objectives slide). */
  lessonPass?: number;
  /** Stream: the master check's fixes over the whole lesson, each with its reason and outcome. */
  masterCheck?: {
    ms: number;
    fixes: { slide: number; field: string; kind: string; problem: string; outcome: string }[];
  };
};

export async function planWriteSlides(
  state: PipelineState,
  deps: PipelineDeps,
): Promise<PipelineState> {
  const base = state.lesson;
  const brief = base.brief;
  if (!brief) throw new Error("plan-write: the lesson has no brief");
  const mode = planWriteMode();
  // Plan-write reads the checked table saved by the plan step; the stream fills these in when its
  // plan header closes.
  let record: SlidePlanRecord = {
    plan: { misconception: "", objectives: [], runningExample: "", slides: [] },
    switched: [],
    problems: [],
    repaired: false,
  };
  let objectives: Objectives = [];
  let baseFacts = base.facts as LessonFacts;
  if (mode === "plan-write") {
    const parsed = SlidePlanRecordSchema.safeParse(base.facts?.slidePlan);
    if (!parsed.success)
      throw new StageFailure("generate", "plan-write: the lesson has no slide table");
    record = parsed.data;
    objectives = base.facts?.objectives ?? [];
  }
  let table: PlanSlide[] = record.plan.slides;
  const slideCount = mode === "stream" ? (brief.slideCount ?? DEFAULT_SLIDE_COUNT) : table.length;
  const themeId = base.themeId;
  const cls = planClassFor(base, deps);
  const audience = audienceOf(base);
  const startedAt = Date.parse(base.generation?.startedAt ?? "") || Date.now();
  const at = () => deps.now().toISOString();
  const findings: Finding[] = [...(base.generation?.findings ?? [])];
  const stamp = mode === "stream" ? STREAM_WRITE_VERSION : PLAN_WRITE_VERSION;
  const codeMeta = (): MaterialiseMeta => ({
    promptVersion: stamp,
    model: CODE_MODEL,
    at: at(),
  });
  const objectiveIds = (s: PlanSlide) => {
    const ids = s.objectives.flatMap((n) =>
      objectives[n - 1] ? [objectives[n - 1]?.id as string] : [],
    );
    return ids.length > 0 ? ids : [objectives[0]?.id ?? "o1"];
  };

  // The fixed slides (UX ruling 134): the title with its picture, keeping the saved title's id,
  // then the objectives on their own slide.
  const [title] = base.slides;
  if (!title) throw new Error("plan-write: the plan step has not run");
  let lesson: Lesson = { ...base, slides: [title], fitVersion: FIT_VERSION };
  const outline: OutlineEntry[] = Array.from({ length: slideCount }, (_, i) => ({
    id: `s${i + 1}`,
    kind: "content",
    factRefs: [],
  }));
  const titlePhotos: Promise<void>[] = [];
  const drawTitle = () => {
    const spec = {
      kind: "title" as const,
      title: base.title,
      subtitle: [base.yearGroup, base.subject].filter(Boolean).join(" · ") || "Lesson",
      factRefs: objectives.map((o) => o.id),
    };
    // The title with no picture: the slides package's no-picture title variant when it fits.
    const titleWithoutPicture = () => {
      const variant = withoutPicture(spec, "split").variant;
      return variant && fitsPlanned(spec, { variant, stepDown: 0 }).ok
        ? materialiseSlide(spec, themeId, codeMeta(), deps.ids, variant)
        : materialiseSlide(spec, themeId, codeMeta(), deps.ids);
    };
    const pic = table[0]?.imageBrief;
    // The title always has a picture (ruling 134): beside the title when it fits there, else under
    // it in a band, a taller band for a long title. Only with a photo search to fill it: an empty
    // frame never reaches the class, so the picture-less title stays the fallback.
    const pictureVariant =
      pic && deps.images
        ? TITLE_PICTURE_ORDER.find((variant) => fitsPlanned(spec, { variant, stepDown: 0 }).ok)
        : undefined;
    const split = pictureVariant !== undefined;
    const drawnTitle = pictureVariant
      ? materialiseSlide(spec, themeId, codeMeta(), deps.ids, pictureVariant)
      : titleWithoutPicture();
    lesson = { ...lesson, slides: [{ ...drawnTitle, id: title.id }] };
    const imageBrief: ImageBrief | undefined =
      split && pic
        ? {
            subject: plainSubject(pic.subject).slice(0, 60),
            mustShow: pic.mustShow.slice(0, 3).map((m) => m.slice(0, 60)),
            purpose: "context",
            ...namedOf(pic.named),
          }
        : undefined;
    // The saved outline keeps imageBrief to image-text entries (domain rule); the title's brief goes
    // only to its photo search.
    outline[0] = { id: "s1", kind: "title", factRefs: objectives.map((o) => o.id) };
    outline[1] = { id: "s2", kind: "objectives", factRefs: objectives.map((o) => o.id) };
    ready.set(
      1,
      materialiseSlide(
        {
          kind: "objectives",
          items: objectives.slice(0, 4).map((o) => o.text),
          factRefs: objectives.map((o) => o.id),
        },
        themeId,
        codeMeta(),
        deps.ids,
      ),
    );
    void flush();
    if (imageBrief && deps.images) {
      titlePhotos.push(
        findPhoto(0, imageBrief).then((photo) => {
          if (photo) return placePhoto(0, photo);
          // No photo after the retry: the title stands alone, never beside an empty frame.
          noPicture.push(1);
          deps.logger.info({ stage: "generate", slide: 1 }, "title drawn without its picture");
          return updateSlide(0, () => ({ ...titleWithoutPicture(), id: title.id }));
        }),
      );
    }
  };

  // Saved in slide order, one write at a time; `ready` holds slides waiting for an earlier one.
  const ready = new Map<number, Slide>();
  let writing: Promise<void> = Promise.resolve();
  let firstSlideMs: number | undefined;
  const flush = () => {
    writing = writing.then(async () => {
      let wrote = false;
      while (ready.has(lesson.slides.length)) {
        const index = lesson.slides.length;
        lesson = { ...lesson, slides: [...lesson.slides, ready.get(index) as Slide] };
        ready.delete(index);
        wrote = true;
      }
      if (!wrote || deps.signal.aborted) return;
      const { updatedAt } = await deps.persist(withUsage(lesson, deps));
      firstSlideMs ??= Date.now() - startedAt;
      const n = lesson.slides.length;
      await deps.onProgress(
        Math.round(PROGRESS_SLIDES_FROM + (PROGRESS_SLIDES_SPAN * n) / slideCount),
        `Slide ${n} of ${slideCount}`,
        "generate",
        updatedAt,
      );
    });
    return writing;
  };

  const target = (n: number): WriteSlideTarget => {
    const s = table[n - 1] as PlanSlide;
    return { number: n, form: s.form, layout: s.layout, contract: contractFor(s.form, s.layout) };
  };
  const writerInput = (slides: WriteSlideTarget[]): WriteSlidesInput => ({
    topic: brief.topic,
    audience,
    objectives: objectives.map((o) => o.text),
    runningExample: record.plan.runningExample,
    misconception: record.plan.misconception,
    table,
    slides,
  });
  const callWriter = async <T>(
    input: WriteSlidesInput,
    schema: z.ZodType<T>,
    maxOutputTokens: number,
  ) => {
    throwIfAborted(deps.signal);
    const call = await callStructured({
      deps,
      stage: "generate",
      cls,
      effort: "low",
      prompt: asPrompt<WriteSlidesInput>(WRITE_SLIDES_VERSION, writeSlidesPrompt(input)),
      input,
      schema,
      maxOutputTokens,
    });
    return { output: call.output as T, modelId: call.modelId };
  };

  const placed: Placed[] = [];
  /** Diagram slots' specs by slide number, saved with the slide plan for the diagram renderer. */
  const diagrams: Record<string, unknown> = {};
  const report: PlanWriteReport["slides"] = [];
  const photos: Promise<void>[] = [];
  const photoCounts = { requested: 0, placed: 0 };
  const failedBatches: number[][] = [];

  /** One slide changed in place: saved when it is already saved, else changed while it waits. */
  const updateSlide = (index: number, change: (slide: Slide) => Slide) => {
    writing = writing.then(async () => {
      const slide = lesson.slides[index];
      if (slide) {
        lesson = { ...lesson, slides: lesson.slides.map((s, i) => (i === index ? change(s) : s)) };
        if (!deps.signal.aborted) await deps.persist(withUsage(lesson, deps));
      } else {
        const waiting = ready.get(index);
        if (waiting) ready.set(index, change(waiting));
      }
    });
    return writing;
  };

  /** Photos placed so far by slide index, so a slide drawn again keeps its photo. */
  const photoOf = new Map<number, PlacedPhoto>();
  const withPlaced = (slide: Slide, photo: PlacedPhoto): Slide => ({
    ...slide,
    elements: slide.elements.map((e) =>
      e.type === "image" && e.src === PLACEHOLDER_IMAGE ? withPhoto(e, photo) : e,
    ),
  });
  const placePhoto = (index: number, photo: PlacedPhoto) => {
    photoOf.set(index, photo);
    return updateSlide(index, (slide) => withPlaced(slide, photo));
  };

  const photoReady: NonNullable<PlanWriteReport["photoReady"]> = {};
  const noPicture: number[] = [];
  /**
   * A slide's photo: the search and pick for its brief, and when that finds nothing, ONE retry with
   * a broader query. Undefined when neither placed a photo (the caller drops the slot).
   */
  const findPhoto = async (index: number, brief: ImageBrief): Promise<PlacedPhoto | undefined> => {
    photoCounts.requested += 1;
    const tryOne = (b: ImageBrief) =>
      pickPhoto(
        {
          ...lesson,
          facts: {
            ...baseFacts,
            outline: outline.map((e, i) => (i === index ? { ...e, imageBrief: b } : e)),
          },
        },
        index,
        deps,
      );
    let picked = await tryOne(brief);
    const wider =
      picked.outcome === "placed" || picked.outcome === "busy" ? undefined : broadenedBrief(brief);
    if (wider) picked = await tryOne(wider);
    const ms = Date.now() - startedAt;
    photoReady[index + 1] = { ms, outcome: picked.outcome, retried: wider !== undefined };
    deps.logger.info(
      {
        stage: "generate",
        call: "photo",
        slide: index + 1,
        ms,
        outcome: picked.outcome,
        retried: wider !== undefined,
      },
      "slide photo ready",
    );
    if (picked.outcome !== "placed") return undefined;
    photoCounts.placed += 1;
    return picked.photo;
  };

  const drawn = (
    form: string,
    layout: string,
    out: Written,
    meta: MaterialiseMeta,
    role?: string,
  ): Slide => {
    const r = renderWritten(form, layout, out, role);
    const slide = materialiseSlide(r.spec, themeId, meta, deps.ids, r.variant, r.structure);
    if (isSetForm(form)) return withSetTag(withAnswersReveal(slide, themeId), form, role);
    // A diagram slot's spec is drawn by the diagram renderer; one that does not draw keeps the slot.
    const spec = form === "diagram-slot" ? out.diagram : undefined;
    return spec && typeof spec === "object"
      ? withDiagramDrawn(slide, getTheme(themeId), spec)
      : slide;
  };

  /** A slide drawn again from its placed record (form and fields now), keeping id and photo. */
  const redraw = (index: number, meta: MaterialiseMeta) =>
    updateSlide(index, (old) => {
      const p = placed.find((x) => x.index === index);
      if (!p) return old;
      const fresh = drawn(p.plan.form, p.plan.layout, p.out, meta, p.plan.role);
      const photo = photoOf.get(index);
      return { ...(photo ? withPlaced(fresh, photo) : fresh), id: old.id };
    });

  /** Whether a diagram slot's spec draws; a slot that does not would stay empty. */
  const diagramDraws = (layout: string, out: Written): boolean => {
    const spec = out.diagram;
    if (!spec || typeof spec !== "object") return false;
    const r = renderWritten("diagram-slot", layout, out);
    const slide = materialiseSlide(r.spec, themeId, codeMeta(), deps.ids, r.variant, r.structure);
    return withDiagramDrawn(slide, getTheme(themeId), spec) !== slide;
  };

  /** A saved picture slide whose photo was not found: drawn again with the text full width. */
  const dropPicture = (n: number) => {
    const index = n - 1;
    const p = placed.find((x) => x.index === index);
    if (!p) return;
    noPicture.push(n);
    p.plan = { ...p.plan, ...NO_PICTURE_ROW };
    p.out = noPictureOf(p.out);
    table[index] = { ...(table[index] as PlanSlide), ...NO_PICTURE_ROW };
    const e = outline[index];
    if (e) {
      const { imageBrief: _i, ...rest } = e;
      outline[index] = { ...rest, kind: "content" } as OutlineEntry;
    }
    const r = report.find((x) => x.slide === n);
    if (r) Object.assign(r, { form: "explain", layout: "default", noPicture: true });
    deps.logger.info({ stage: "generate", slide: n }, "slide drawn without its picture");
    return redraw(index, codeMeta());
  };

  const menu = planMenu(base.subject);
  /**
   * The hinge gate (UX ruling 136): a hinge that still does not fit after its re-write is written
   * ONCE as another check on the same idea. Undefined when that call fails or writes no such check.
   */
  const recheck = async (n: number, current: Written, failure: string) => {
    const kinds = recheckKinds(menu);
    if (kinds.length === 0) return undefined;
    try {
      const schema = z.object({ slide: streamSlideSchema(kinds) });
      const { output } = await callWriter(
        {
          ...writerInput([target(n)]),
          recheck: {
            slide: target(n),
            failure,
            current,
            kinds: kinds.map((k) => ({
              kind: kindOf(k.form, k.layout),
              contract: contractFor(k.form, k.layout),
            })),
          },
        },
        schema as unknown as z.ZodType<{ slide: Record<string, unknown> }>,
        MAX_OUTPUT_TOKENS_REWRITE,
      );
      const got = checkStreamed(output.slide, kinds);
      deps.logger.info(
        { stage: "generate", call: "recheck", slide: n, failure, to: got?.form ?? null },
        "plan-write hinge re-planned as another check",
      );
      return got?.out ? { form: got.form, layout: got.layout, out: got.out } : undefined;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      deps.logger.error(
        { stage: "generate", call: "recheck", slide: n, err: safeError(error) },
        "hinge re-plan failed; the hinge is kept and flagged",
      );
      return undefined;
    }
  };

  /* ---------------------------------------------------------- per-slide check (stream) */

  const verify = { corrections: 0, refitted: 0, rejected: 0 };
  const checker = checkBatcher({
    limit: SLIDE_CHECK_CONCURRENCY,
    maxGroup: CHECK_GROUP_MAX,
    last: slideCount,
    run: (group) => checkSlides(group),
  });
  const checks: NonNullable<PlanWriteReport["checks"]> = {};
  const onSlide = (slideId: string | undefined) => (slideId ? { slideId } : {});
  const budgetOnce = (f: Finding[]) =>
    f.filter((g) => g.check !== "budget" || !findings.some((x) => x.check === "budget"));

  /** One named field of a slide written again, told what a check found. */
  const checkRewrite = async (
    n: number,
    field: string,
    failure: string,
    current: Written,
    reason: "check" | "fit" = "check",
  ) => {
    const s = table[n - 1] as PlanSlide;
    const only = (slideWriterSchema(s.form, s.layout) as unknown as z.ZodObject).shape[field];
    if (!only) return undefined;
    try {
      const { output } = await callWriter(
        {
          ...writerInput([target(n)]),
          rewrite: { slide: target(n), field, failure, current, reason },
        },
        z.object({ [field]: only }) as z.ZodType<Written>,
        MAX_OUTPUT_TOKENS_REWRITE,
      );
      deps.logger.info(
        { stage: "generate", call: "check-rewrite", slide: n, field },
        "plan-write check re-write",
      );
      return field in output ? output[field] : undefined;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      deps.logger.warn(
        { stage: "generate", call: "check-rewrite", slide: n, field, err: safeError(error) },
        "check re-write failed; the slide is kept",
      );
      return undefined;
    }
  };

  /** One slide as its check reads it: its written words, its facts (ids local to the slide). */
  const checkInput = (n: number) => {
    const index = n - 1;
    const p = placed.find((x) => x.index === index);
    if (!p) return undefined;
    let c = 0;
    const local = (prefix: string) => `${prefix}${n * 100 + ++c}`;
    // The slide as the check starts: a picture dropped while it runs changes `p.plan` (see below).
    const { form, layout } = p.plan;
    const before = p.out;
    const f = factsOfWritten(form, before, objectiveIds(p.plan), local);
    const ids = new Set(
      [...f.keyIdeas, ...f.questions, ...f.workedExamples, ...f.vocabulary].map((x) => x.id),
    );
    const hasFacts = ids.size > 0 || f.retrieval.length > 0;
    return { n, index, p, form, layout, before, f, ids, hasFacts };
  };

  /** Whether a closed slide goes to the check queue, and whether it may share a call. */
  const queueCheck = (n: number) => {
    const input = checkInput(n);
    if (!input) return;
    if (skipsCheck(input.p.plan.form, input.p.out, input.hasFacts)) {
      deps.logger.info({ stage: "generate", call: "slide-check", slide: n }, "slide check skipped");
      return;
    }
    checker.add(n, isSmallForCheck(input.p.out));
  };

  /**
   * The check of one slide, or of a few neighbouring small slides in one call, once they have
   * closed: Verify over their facts (with the lesson's objectives) beside Evaluate over them; each
   * slide's Verify corrections written into that slide; then per slide one named-field re-write per
   * field the answer key (code) or a finding names, at most two; then the fit (one re-write of a
   * failing field). A checked slide is saved when it fits, else the slide as written stays and the
   * findings stand.
   */
  const checkSlides = async (group: number[]) => {
    throwIfAborted(deps.signal);
    const startMs = Date.now() - startedAt;
    const inputs = group.map(checkInput).filter((x) => x !== undefined);
    if (inputs.length === 0) return;
    deps.logger.info(
      { stage: "generate", call: "slide-check", slides: group, startMs },
      "slide check start",
    );
    const retrieval = inputs.flatMap((i) => i.f.retrieval);
    const scoped: LessonFacts = {
      ...baseFacts,
      keyIdeas: inputs.flatMap((i) => i.f.keyIdeas),
      questions: inputs.flatMap((i) => i.f.questions),
      workedExamples: inputs.flatMap((i) => i.f.workedExamples),
      vocabulary: inputs.flatMap((i) => i.f.vocabulary),
      ...(retrieval.length > 0 ? { retrieval } : {}),
    };
    // Verify reads only these slides' facts: the lesson's misconception (its correction still blank
    // in the stream) is not theirs, and every check's Verify would "correct" it again.
    const checked: LessonFacts = { ...scoped, misconceptions: [] };
    const current = inputs.map((i) => ({ i, slide: lesson.slides[i.index] ?? ready.get(i.index) }));
    const shown = current.flatMap((x) => (x.slide ? [x.slide] : []));
    const [verified, reviewed] = await Promise.all([
      inputs.some((i) => i.hasFacts)
        ? runVerify(checked, { topic: brief.topic, audience }, deps, cls, VERIFY_EFFORT)
        : undefined,
      shown.length > 0
        ? evaluateSlides(
            { ...state, lesson: { ...lesson, facts: scoped, slides: shown } },
            shown.map((x) => x.id),
            deps,
          ).catch((error): Finding[] => {
            if (error instanceof Error && error.name === "AbortError") throw error;
            if (error instanceof BudgetExceeded) return [BUDGET_FINDING(error.by, "the review")];
            deps.logger.warn(
              { stage: "evaluate", slides: group, err: safeError(error) },
              "slide review failed; the slides are kept",
            );
            return [];
          })
        : [],
    ]);
    throwIfAborted(deps.signal);
    const changed = verified ? changedStrings(checked, verified.facts) : [];
    const ownerOf = (factId: string | undefined) =>
      inputs.find((i) => factId !== undefined && i.ids.has(factId)) ?? inputs[0];
    for (const [k, { i, slide }] of current.entries()) {
      const first = k === 0;
      const slideId = slide?.id;
      const verifyFindings = (verified?.findings ?? []).filter((g) =>
        g.check === "budget" ? first : ownerOf(g.target.factId) === i,
      );
      const own = changed.filter(([id]) => i.ids.has(id));
      const corrections = (verified?.applied ?? []).filter((a) => ownerOf(a.factId) === i).length;
      const reviewedHere = reviewed.filter((r) =>
        r.check === "budget" ? first : r.target.slideId === slideId,
      );
      await finishCheck(i, startMs, slideId, verifyFindings, own, corrections, reviewedHere);
    }
  };

  /** One slide's part of a check: its corrections, re-writes, fit and findings. */
  const finishCheck = async (
    { n, index, p, form, layout, before }: NonNullable<ReturnType<typeof checkInput>>,
    startMs: number,
    slideId: string | undefined,
    verifyFindings: Finding[],
    own: [string, string, string][],
    corrections: number,
    reviewed: Finding[],
  ) => {
    const kept: Finding[] = [];
    for (const g of verifyFindings)
      kept.push(g.check === "budget" ? g : { ...g, target: onSlide(slideId) });
    let out = own.reduce((o, [, from, to]) => replaced(o, from, to), before);
    const review = reviewed.filter((r) => r.check !== "budget");
    kept.push(...reviewed.filter((r) => r.check === "budget"));
    // The fields to write again: the answer key (code) first, then the review's findings by the
    // field their quoted evidence sits in.
    const asks = new Map<string, string[]>();
    const ask = (field: string, why: string) => asks.set(field, [...(asks.get(field) ?? []), why]);
    for (const k of answerKeyMismatches(form, out)) ask(k.field, k.failure);
    const fieldOf = new Map<Finding, string | undefined>();
    for (const r of review) {
      const field = fieldOfEvidence(out, r.evidence);
      fieldOf.set(r, field);
      if (field) ask(field, r.evidence ? `${r.message} ("${r.evidence}")` : r.message);
    }
    const rewrites: string[] = [];
    for (const [field, whys] of [...asks.entries()].slice(0, 2)) {
      const value = await checkRewrite(n, field, whys.join("; "), out);
      if (value === undefined) continue;
      out = { ...out, [field]: value };
      rewrites.push(field);
    }
    let saved = false;
    if (JSON.stringify(out) !== JSON.stringify(before)) {
      const fitted = await fitWithRewrite(form, layout, out, async (field, failure) => {
        const value = await checkRewrite(n, field, failure, out, "fit");
        return value === undefined ? undefined : { [field]: value };
      });
      if (fitted.fit.ok) {
        // A picture dropped while the check ran: the checked words go on the no-picture slide.
        const now = p.plan.form === form ? fitted.out : noPictureOf(fitted.out);
        if (p.plan.form === form || fitWritten(p.plan.form, p.plan.layout, now).ok) {
          p.out = now;
          saved = true;
          await redraw(index, {
            promptVersion: joinVersions(WRITE_SLIDES_VERSION, verifyFactsPrompt.version),
            model: "slide-check",
            at: at(),
          });
        }
      }
    }
    verify.corrections += corrections;
    if (corrections > 0) {
      if (saved) verify.refitted += 1;
      else verify.rejected += 1;
    }
    for (const k of answerKeyMismatches(p.plan.form, p.out)) {
      kept.push({
        check: "answer-key",
        severity: "warning",
        target: onSlide(slideId),
        message: `The answer key does not hold: ${k.failure}.`,
      });
    }
    // A finding whose field was written again and saved is repaired; the rest stand.
    for (const r of review) {
      const field = fieldOf.get(r);
      if (saved && field && rewrites.includes(field)) continue;
      kept.push(r);
    }
    findings.push(...budgetOnce(kept));
    const endMs = Date.now() - startedAt;
    checks[n] = {
      startMs,
      endMs,
      corrections,
      findings: kept.length,
      rewrites,
      saved,
    };
    deps.logger.info(
      {
        stage: "generate",
        call: "slide-check",
        slide: n,
        startMs,
        endMs,
        corrections,
        rewrites,
        saved,
      },
      "slide check end",
    );
  };

  /** One written slide: fitted (one re-write of a failing field), drawn, queued, photo searched. */
  const land = async (n: number, out: Written, modelId: string) => {
    const index = n - 1;
    let s = table[index] as PlanSlide;
    let fitted = await fitWithRewrite(s.form, s.layout, out, async (field, failure) => {
      const shape = (slideWriterSchema(s.form, s.layout) as unknown as z.ZodObject).shape;
      const only = shape[field];
      if (!only) return undefined;
      const schema = z.object({ [field]: only });
      const { output } = await callWriter(
        {
          ...writerInput([target(n)]),
          rewrite: { slide: target(n), field, failure, current: out },
        },
        schema as z.ZodType<Written>,
        MAX_OUTPUT_TOKENS_REWRITE,
      );
      deps.logger.info(
        { stage: "generate", call: "rewrite", slide: n, field, failure },
        "plan-write re-write",
      );
      return output;
    });
    let rechecked: string | undefined;
    if (s.form === "hinge" && !fitted.fit.ok) {
      const again = await recheck(n, fitted.out, fitted.fit.failure);
      if (again) {
        rechecked = `${s.form} -> ${again.form}`;
        s = { ...s, form: again.form, layout: again.layout };
        table[index] = s;
        fitted = { out: again.out, fit: fitWritten(s.form, s.layout, again.out) };
      }
    }
    // An empty picture or drawing never reaches the class: a figure brief (drawn later by no step
    // here), a diagram spec that does not draw, or a photo with no search to fill it takes the
    // no-picture layout, its text full width.
    if (
      PICTURE_FORMS.has(s.form) &&
      (s.form === "photo"
        ? !deps.images
        : s.form === "figure" || !diagramDraws(s.layout, fitted.out))
    ) {
      deps.logger.info(
        { stage: "generate", slide: n, form: s.form },
        "slide drawn without its picture",
      );
      noPicture.push(n);
      s = { ...s, ...NO_PICTURE_ROW };
      table[index] = s;
      const out2 = noPictureOf(fitted.out);
      fitted = { out: out2, fit: fitWritten(NO_PICTURE_ROW.form, NO_PICTURE_ROW.layout, out2) };
    }
    report.push({
      slide: n,
      form: s.form,
      layout: s.layout,
      fits: fitted.fit.ok,
      ...(fitted.rewritten ? { rewritten: fitted.rewritten } : {}),
      ...(rechecked ? { rechecked } : {}),
    });
    placed.push({ index, plan: s, out: fitted.out });
    if (s.form === "diagram-slot" && fitted.out.diagram && typeof fitted.out.diagram === "object") {
      diagrams[String(n)] = fitted.out.diagram;
    }
    const slide = drawn(
      s.form,
      s.layout,
      fitted.out,
      { promptVersion: WRITE_SLIDES_VERSION, model: modelId, at: at() },
      s.role,
    );
    if (!fitted.fit.ok) {
      findings.push({
        check: "fit",
        severity: "warning",
        target: { slideId: slide.id },
        message: `This slide does not fit the save gate: ${fitted.fit.failure}.`,
      });
    }
    const brief0 =
      s.form === "photo"
        ? (fitted.out.imageBrief as
            | { subject: string; named?: string | null; mustShow?: string[] }
            | undefined)
        : undefined;
    const imageBrief: ImageBrief | undefined = brief0
      ? {
          subject: plainSubject(brief0.subject).slice(0, 60),
          mustShow: (brief0.mustShow ?? []).slice(0, 3).map((m) => m.slice(0, 60)),
          purpose: "context",
          ...namedOf(brief0.named),
        }
      : undefined;
    const kind = renderWritten(s.form, s.layout, fitted.out).spec.kind as OutlineEntry["kind"];
    const spec = renderWritten(s.form, s.layout, fitted.out).spec as { callout?: { kind: string } };
    outline[index] = {
      id: `s${n}`,
      kind: imageBrief ? "image-text" : kind,
      factRefs: objectiveIds(s),
      brief: { adds: s.purpose },
      phase:
        s.form === "starter-set"
          ? "starter"
          : isSetForm(s.form) ||
              ["hinge", "true-false", "matching", "fill-gap", "sort", "open-response"].includes(
                s.form,
              )
            ? "check"
            : "explain",
      ...(imageBrief ? { imageBrief } : {}),
      ...(spec.callout ? { callout: { kind: spec.callout.kind, factRefs: ["m1"] } } : {}),
    } as OutlineEntry;
    ready.set(index, slide);
    void flush();
    if (imageBrief && deps.images) {
      photos.push(
        findPhoto(index, imageBrief).then((photo) =>
          photo ? placePhoto(index, photo) : dropPicture(n),
        ),
      );
    }
    // Stream: the slide's check starts now, beside the stream still writing (bounded).
    if (mode === "stream") queueCheck(n);
  };

  if (mode === "plan-write") drawTitle();

  /** A batch whose writer failed twice: each slide asks about its purpose, flagged. */
  const missing: number[] = [];
  const landMissing = async (n: number) => {
    missing.push(n);
    const s = table[n - 1] as PlanSlide;
    const out: Written = { prompt: s.purpose, footnote: [], notes: "" };
    const index = n - 1;
    const slide = drawn("discussion", "default", out, codeMeta());
    placed.push({ index, plan: { ...s, form: "discussion", layout: "default" }, out });
    report.push({ slide: n, form: "discussion", layout: "default", fits: true });
    outline[index] = {
      id: `s${n}`,
      kind: "discussion",
      factRefs: objectiveIds(s),
      phase: "explain",
    } as OutlineEntry;
    findings.push({
      check: "missing-material",
      severity: "warning",
      target: {},
      message: `Slide ${n} could not be written; it asks about its purpose instead.`,
    });
    ready.set(index, slide);
    void flush();
  };

  const runBatch = async (batch: number[]) => {
    const targets = batch.map(target);
    const schema = z.object(
      Object.fromEntries(
        targets.map((t) => [`slide${t.number}`, slideWriterSchema(t.form, t.layout)]),
      ),
    );
    for (const attempt of [1, 2] as const) {
      try {
        const { output, modelId } = await callWriter(
          writerInput(targets),
          schema,
          WRITER_OUTPUT_TOKENS_BASE + WRITER_OUTPUT_TOKENS_PER_SLIDE * batch.length,
        );
        const written = output as Record<string, Written>;
        await Promise.all(batch.map((n) => land(n, written[`slide${n}`] as Written, modelId)));
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        deps.logger.error(
          {
            stage: "generate",
            call: "write-slides",
            slides: batch,
            attempt,
            err: safeError(error),
          },
          attempt === 1 ? "writer failed; retrying once" : "writer failed twice",
        );
      }
    }
    failedBatches.push(batch);
    await Promise.all(batch.map(landMissing));
  };

  const stream: { headerMs?: number; slidesMs: Record<number, number> } = { slidesMs: {} };

  /** The stream's plan header: checked (no repair call), saved, and the title redrawn. */
  const takeHeader = (w: Partial<StreamLessonWire>, menu: ReturnType<typeof planMenu>) => {
    const { plan, unreadable } = parsePlan({
      misconception: w.misconception ?? "",
      objectives: w.objectives ?? [],
      runningExample: w.runningExample ?? "",
      titlePicture: w.titlePicture ?? null,
      slides: (w.plan ?? []).filter((r): r is string => typeof r === "string"),
    });
    const c = checkPlan(plan, { slideCount, menu });
    const problems = [
      ...unreadable.map((n) => ({
        rule: "form" as const,
        slide: n,
        message: `Row for slide ${n} is not 8 fields split by " | ".`,
      })),
      ...c.problems,
    ];
    record = { plan: c.plan, switched: c.switched, problems, repaired: false };
    table = [...c.plan.slides];
    objectives =
      state.pinObjectives && (base.facts?.objectives.length ?? 0) > 0
        ? (base.facts?.objectives ?? [])
        : c.plan.objectives.map((text, i) => ({ id: `o${i + 1}`, text }));
    baseFacts = plannedFacts(record, objectives, brief.durationMin);
    drawTitle();
    lesson = {
      ...lesson,
      facts: baseFacts,
      generation: {
        jobId: deps.context.jobId,
        stage: "planned",
        startedAt: new Date(startedAt).toISOString(),
        promptVersions: { planned: stamp },
        usage: deps.budget.totals(),
        findings: [],
      },
    };
    stream.headerMs = Date.now() - startedAt;
    deps.logger.info(
      { stage: "generate", call: "stream", ms: stream.headerMs, problems, switched: c.switched },
      "stream header",
    );
    writing = writing.then(async () => {
      if (!deps.signal.aborted) await deps.persist(withUsage(lesson, deps));
    });
  };

  /** A row for a slide the plan has none for: the stream's own slide, or a flagged gap. */
  const rowFor = (n: number): PlanSlide =>
    table[n - 1] ?? {
      role: "teach",
      objectives: [],
      tests: [],
      teaches: [],
      purpose: brief.topic,
      parts: 0,
      form: "discussion",
      layout: "default",
      imageBrief: null,
      figureBrief: null,
    };

  /** One call plans and writes the whole lesson; each slide lands as it closes. */
  const runStream = async () => {
    const input: StreamLessonInput = {
      topic: brief.topic,
      audience,
      ...(brief.answers ? { answers: brief.answers } : {}),
      ...(brief.classContext?.priorKnowledge
        ? { priorKnowledge: brief.classContext.priorKnowledge }
        : {}),
      slideCount,
      menu,
    };
    const routed = deps.ai.model(cls, callContext(deps, "generate", STREAM_LESSON_VERSION, "low"));
    const streamModel = typeof routed === "string" ? routed : routed.modelId;
    const landed = new Set<number>();
    const pending: Promise<void>[] = [];
    let header = false;
    const close = (i: number, raw: unknown) => {
      const n = i + 1 + FIXED_SLIDES;
      if (landed.has(n)) return;
      if (n > slideCount) {
        deps.logger.warn({ stage: "generate", slide: n }, "stream wrote a slide past the count");
        return;
      }
      landed.add(n);
      stream.slidesMs[n] = Date.now() - startedAt;
      const got =
        raw && typeof raw === "object"
          ? checkStreamed(raw as Record<string, unknown>, menu)
          : undefined;
      const row = rowFor(n);
      if (got && (got.form !== row.form || got.layout !== row.layout)) {
        deps.logger.info(
          {
            stage: "generate",
            slide: n,
            row: [row.form, row.layout],
            wrote: [got.form, got.layout],
          },
          "stream slide differs from its row; the slide's kind stands",
        );
      }
      table[n - 1] = got ? { ...row, form: got.form, layout: got.layout } : row;
      if (got?.out) {
        pending.push(land(n, got.out, streamModel));
        return;
      }
      deps.logger.warn(
        { stage: "generate", slide: n, problem: got?.problem ?? "unknown kind" },
        "stream slide not drawable; written again by a writer",
      );
      pending.push(runBatch([n]));
    };
    const onPartial = (partial: unknown) => {
      const w = partial as Partial<StreamLessonWire>;
      const slides = Array.isArray(w?.slides) ? w.slides : [];
      if (!header && slides.length > 0) {
        header = true;
        takeHeader(w, menu);
      }
      if (header) for (let i = 0; i < slides.length - 1; i++) close(i, slides[i]);
    };
    try {
      const call = await callStructured({
        deps,
        stage: "generate",
        cls,
        effort: "low",
        prompt: asPrompt<StreamLessonInput>(STREAM_LESSON_VERSION, streamLessonPrompt(input)),
        input,
        schema: streamLessonSchema(menu) as unknown as z.ZodType<StreamLessonWire>,
        lenient: streamLessonLenient,
        maxOutputTokens: MAX_OUTPUT_TOKENS_STREAM,
        onPartial,
      });
      const w = call.output;
      if (!header) {
        header = true;
        takeHeader(w, menu);
      }
      w.slides.forEach((raw, i) => {
        close(i, raw);
      });
    } catch (error) {
      if (!header || (error instanceof Error && error.name === "AbortError")) throw error;
      deps.logger.error(
        { stage: "generate", call: "stream", err: safeError(error) },
        "stream failed after its header; the rest is written by writers",
      );
    }
    for (let n = FIXED_SLIDES + 1; n <= slideCount; n++) {
      if (landed.has(n)) continue;
      landed.add(n);
      if (table[n - 1]) pending.push(runBatch([n]));
      else {
        table[n - 1] = rowFor(n);
        pending.push(landMissing(n));
      }
    }
    await Promise.all(pending);
  };

  if (mode === "stream") {
    try {
      await runStream();
    } finally {
      checker.end();
    }
  } else {
    const numbers = table.map((_, i) => i + 1).filter((n) => n > FIXED_SLIDES);
    await Promise.all(batchesOf(numbers).map(runBatch));
  }
  throwIfAborted(deps.signal);
  await flush();
  await writing;
  if (lesson.slides.length !== slideCount) {
    throw new StageFailure(
      "generate",
      `plan-write: ${lesson.slides.length} of ${slideCount} slides were written`,
    );
  }

  // Facts from what the slides show, in slide order (built again once the checks have landed).
  const refsOf = new Map<number, string[]>();
  const buildFacts = (): LessonFacts => {
    const counters: Record<string, number> = {};
    const next = (prefix: string) => {
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      return `${prefix}${counters[prefix]}`;
    };
    const built: LessonFacts = {
      ...baseFacts,
      ...(Object.keys(diagrams).length > 0
        ? { slidePlan: { ...(baseFacts.slidePlan ?? {}), diagrams } }
        : {}),
      keyIdeas: [],
      vocabulary: [],
      workedExamples: [],
      questions: [],
      outline,
    };
    const retrieval: RetrievalQuestion[] = [];
    for (const p of [...placed].sort((a, b) => a.index - b.index)) {
      const f = factsOfWritten(p.plan.form, p.out, objectiveIds(p.plan), next);
      built.keyIdeas?.push(...f.keyIdeas);
      built.questions.push(...f.questions);
      built.workedExamples.push(...f.workedExamples);
      built.vocabulary.push(...f.vocabulary);
      retrieval.push(...f.retrieval);
      const refs = [...f.keyIdeas, ...f.questions, ...f.workedExamples, ...f.vocabulary].map(
        (x) => x.id,
      );
      refsOf.set(p.index, refs);
      const entry = outline[p.index];
      if (entry) entry.factRefs = [...objectiveIds(p.plan), ...refs];
    }
    if (retrieval.length > 0) built.retrieval = retrieval;
    return built;
  };
  const facts = buildFacts();

  const asGenerated = (l: Lesson, f: LessonFacts): Lesson => {
    const generation = generationOf(l);
    return withUsage(
      {
        ...l,
        facts: { ...f, outline },
        generation: {
          ...generation,
          stage: "generated",
          promptVersions: {
            ...generation.promptVersions,
            planned: joinVersions(stamp, verifyFactsPrompt.version),
            generated: WRITE_SLIDES_VERSION,
          },
          findings: [...findings],
        },
      },
      deps,
    );
  };
  lesson = asGenerated(lesson, facts);
  const { updatedAt } = await deps.persist(lesson);
  const editableMs = Date.now() - startedAt;
  await deps.onProgress(PROGRESS_GENERATED, "Slides ready", "generate", updatedAt);

  /**
   * The master check (stream): one call reads the whole lesson once every slide is written and
   * checked, and names fields to write again for problems between slides (a broken join, the
   * running example dropped or changed, a term used before it is taught, a contradiction, a
   * repeat). Each fix is a named-field re-write and the fit, as a slide check's: saved only when
   * the slide still fits, never shortened, split or moved to the notes. Title and objectives are
   * fixed. Every fix is logged with its reason and outcome.
   */
  const runMasterCheck = async (): Promise<PlanWriteReport["masterCheck"]> => {
    const t0 = Date.now();
    const fixedRoles = new Set(["title", "objectives"]);
    const sorted = [...placed].sort((a, b) => a.index - b.index);
    const input: MasterCheckInput = {
      audience,
      topic: brief.topic,
      objectives: objectives.map((o) => o.text),
      runningExample: record.plan.runningExample,
      slides: sorted.map((p) => ({
        number: p.index + 1,
        role: p.plan.role,
        form: p.plan.form,
        written: p.out as Record<string, unknown>,
      })),
      fixed: table.flatMap((row, i) => (fixedRoles.has(row.role) ? [i + 1] : [])),
    };
    let fixes: z.infer<typeof masterCheckSchema>["fixes"];
    try {
      const call = await callStructured({
        deps,
        stage: "generate",
        cls,
        effort: "low",
        prompt: asPrompt<MasterCheckInput>(MASTER_CHECK_VERSION, masterCheckPrompt(input)),
        input,
        schema: masterCheckSchema,
        maxOutputTokens: MAX_OUTPUT_TOKENS_MASTER_CHECK,
      });
      fixes = (call.output as z.infer<typeof masterCheckSchema>).fixes;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      deps.logger.warn(
        { stage: "generate", call: "master-check", err: safeError(error) },
        "master check failed; the lesson is kept",
      );
      return undefined;
    }
    // One re-write per field: reasons for the same field are joined.
    type Ask = { slide: number; field: string; kind: string; problem: string };
    const asks = new Map<string, Ask>();
    const log: NonNullable<PlanWriteReport["masterCheck"]>["fixes"] = [];
    for (const f of fixes) {
      const p = placed.find((x) => x.index === f.slide - 1);
      const skip = fixedRoles.has(table[f.slide - 1]?.role ?? "")
        ? "fixed slide"
        : !p || fixedRoles.has(p.plan.role)
          ? "no such slide"
          : !(
                f.field in
                (slideWriterSchema(p.plan.form, p.plan.layout) as unknown as z.ZodObject).shape
              )
            ? "no such field"
            : undefined;
      if (skip) {
        log.push({ ...f, outcome: `skipped: ${skip}` });
        continue;
      }
      const key = `${f.slide}:${f.field}`;
      const had = asks.get(key);
      if (had) had.problem = `${had.problem}; ${f.problem}`;
      else if (asks.size < MASTER_CHECK_MAX_FIXES) asks.set(key, { ...f });
      else log.push({ ...f, outcome: "skipped: over the fix limit" });
    }
    const applyOne = async (f: Ask) => {
      const index = f.slide - 1;
      const p = placed.find((x) => x.index === index) as Placed;
      const before = p.out;
      const failure = `Reading the whole lesson found this (${f.kind}): ${f.problem}`;
      const value = await checkRewrite(f.slide, f.field, failure, before);
      if (value === undefined) return "re-write failed";
      const out = { ...before, [f.field]: value };
      const fitted = await fitWithRewrite(p.plan.form, p.plan.layout, out, async (field, why) => {
        const v = await checkRewrite(f.slide, field, why, out, "fit");
        return v === undefined ? undefined : { [field]: v };
      });
      if (!fitted.fit.ok) return `not saved: does not fit (${fitted.fit.failure})`;
      p.out = fitted.out;
      await redraw(index, {
        promptVersion: joinVersions(WRITE_SLIDES_VERSION, MASTER_CHECK_VERSION),
        model: "master-check",
        at: at(),
      });
      return "saved";
    };
    // Different slides in parallel; fields of one slide one after another, each on the last saved.
    const bySlide = new Map<number, Ask[]>();
    for (const f of asks.values()) bySlide.set(f.slide, [...(bySlide.get(f.slide) ?? []), f]);
    await Promise.all(
      [...bySlide.values()].map(async (list) => {
        for (const f of list) {
          const outcome = await applyOne(f).catch((error) => {
            if (error instanceof Error && error.name === "AbortError") throw error;
            return `failed: ${safeError(error).type}`;
          });
          log.push({ ...f, outcome });
          deps.logger.info(
            { stage: "generate", call: "master-check-fix", ...f, outcome },
            "master check fix",
          );
        }
      }),
    );
    const ms = Date.now() - t0;
    deps.logger.info(
      { stage: "generate", call: "master-check", fixes: log.length, ms },
      "plan-write master check",
    );
    return { ms, fixes: log.sort((a, b) => a.slide - b.slide) };
  };

  let finalFacts = facts;
  let checksDoneMs: number | undefined;
  let photosDoneMs: number | undefined;
  let lessonPass: number | undefined;
  let masterCheck: PlanWriteReport["masterCheck"];
  if (mode === "stream") {
    // Each slide was checked as it closed; what is left are the checks and photos still in flight,
    // then the lesson pass for the rules that span slides.
    await Promise.all([
      checker.done().then(() => {
        checksDoneMs = Date.now() - startedAt;
      }),
      Promise.all([...photos, ...titlePhotos]).then(() => {
        photosDoneMs = Date.now() - startedAt;
      }),
    ]);
    await writing;
    throwIfAborted(deps.signal);
    masterCheck = await runMasterCheck();
    await writing;
    throwIfAborted(deps.signal);
    finalFacts = buildFacts();
    const pass = crossSlideFindings(
      placed.map((p) => ({
        number: p.index + 1,
        row: p.plan,
        out: p.out,
        ...(lesson.slides[p.index] ? { slideId: lesson.slides[p.index]?.id } : {}),
      })),
      { objectives: objectives.length, secondSlideKind: lesson.slides[1]?.kind },
    );
    lessonPass = pass.length;
    findings.push(...pass);
    deps.logger.info(
      { stage: "generate", call: "lesson-pass", faults: pass.length, checksDoneMs, photosDoneMs },
      "plan-write lesson pass",
    );
  } else {
    // Verify after the save, beside the photo searches: a correction is written into the slides
    // that show it and lands only when the slide still fits in its own form.
    const [verified] = await Promise.all([
      runVerify(facts, { topic: brief.topic, audience }, deps, cls, VERIFY_EFFORT),
      Promise.all(photos),
      Promise.all(titlePhotos),
    ]);
    await writing;
    for (const f of verified.findings) {
      if (f.check === "budget" && findings.some((g) => g.check === "budget")) continue;
      findings.push(f);
    }
    if (verified.applied.length > 0) {
      verify.corrections = verified.applied.length;
      finalFacts = verified.facts;
      const changes = changedStrings(facts, finalFacts);
      for (const p of placed) {
        const refs = refsOf.get(p.index) ?? [];
        const mine = changes.filter(([id]) => refs.includes(id));
        if (mine.length === 0) continue;
        const out = mine.reduce((o, [, from, to]) => replaced(o, from, to), p.out);
        const fitted = await fitWithRewrite(p.plan.form, p.plan.layout, out, async () => undefined);
        if (!fitted.fit.ok) {
          verify.rejected += 1;
          continue;
        }
        verify.refitted += 1;
        const old = lesson.slides[p.index] as Slide;
        const fresh = drawn(
          p.plan.form,
          p.plan.layout,
          fitted.out,
          {
            promptVersion: joinVersions(WRITE_SLIDES_VERSION, verifyFactsPrompt.version),
            model: "verify",
            at: at(),
          },
          p.plan.role,
        );
        const photo = old.elements.find((e) => e.type === "image" && e.src !== PLACEHOLDER_IMAGE);
        lesson = {
          ...lesson,
          slides: lesson.slides.map((s, i) =>
            i === p.index
              ? {
                  ...fresh,
                  id: old.id,
                  elements: fresh.elements.map((e) =>
                    e.type === "image" && photo?.type === "image"
                      ? {
                          ...e,
                          src: photo.src,
                          alt: photo.alt,
                          ...(photo.source ? { source: photo.source } : {}),
                        }
                      : e,
                  ),
                }
              : s,
          ),
        };
        p.out = fitted.out;
      }
    }
  }
  lesson = asGenerated(lesson, finalFacts);
  if (!deps.signal.aborted) await deps.persist(lesson);

  const summary: PlanWriteReport = {
    slideCount,
    switched: record.switched,
    planProblems: record.problems.length,
    repaired: record.repaired,
    slides: report.sort((a, b) => a.slide - b.slide),
    mode,
    requested: slideCount,
    delivered: lesson.slides.length - missing.length,
    fitFirstTime: report.filter((r) => r.fits && !r.rewritten).length,
    ...(stream.headerMs !== undefined
      ? { streamHeaderMs: stream.headerMs, streamSlidesMs: stream.slidesMs }
      : {}),
    failedBatches,
    ...(firstSlideMs !== undefined ? { firstSlideMs } : {}),
    editableMs,
    verify,
    photos: photoCounts,
    ...(mode === "stream"
      ? {
          checks,
          photoReady,
          noPicture,
          ...(checksDoneMs !== undefined ? { checksDoneMs } : {}),
          ...(photosDoneMs !== undefined ? { photosDoneMs } : {}),
          ...(lessonPass !== undefined ? { lessonPass } : {}),
          ...(masterCheck ? { masterCheck } : {}),
        }
      : { ...(noPicture.length > 0 ? { noPicture } : {}) }),
  };
  deps.logger.info({ stage: "generate", planWrite: summary }, "plan-write report");
  return { ...state, lesson, ...(mode === "stream" ? { checkedPerSlide: true } : {}) };
}

/**
 * The writer's `named` (a proper name or null) as the photo search reads it (ruling 139): a name
 * sends the search to Commons first with that name; null keeps it to Pexels.
 */
export function namedOf(named: string | null | undefined): Pick<ImageBrief, "named" | "specific"> {
  const name = typeof named === "string" ? named.trim().slice(0, 80) : "";
  return name ? { named: name, specific: true } : { specific: false };
}
