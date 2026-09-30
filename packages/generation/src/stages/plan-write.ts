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
} from "@tj/slides";
import { z } from "zod";
import { callStructured } from "../call";
import { blocking, checkPlan, FIXED_SLIDES, type PlanCheck } from "../plan-write/check";
import { fitWithRewrite, fitWritten, renderWritten, type Written } from "../plan-write/fit";
import { liveFields } from "../plan-write/live";
import { contractFor, isSetForm, planMenu, slideWriterSchema } from "../plan-write/menu";
import { recheckKinds } from "../plan-write/recheck";
import { PLAN_WRITE_VERSION, STREAM_WRITE_VERSION } from "../plan-write/steps";
import {
  checkStreamed,
  formOfKind,
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
  callContext,
  type PipelineDeps,
  type PipelineState,
  StageFailure,
  throwIfAborted,
} from "../types";
import { VERIFY_EFFORT } from "./designer";
import { withUsage } from "./generate";
import { emptyFinding, joinVersions, type PlacedPhoto, pickPhoto, withPhoto } from "./illustrate";
import { existingTitle, materialiseTitle } from "./plan";
import { audienceOf, generationOf, planClassFor } from "./shared";
import { runVerify } from "./verify";

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

/** Live writing (spike): the in-progress slide goes out at most this often. */
const LIVE_MS = 100;

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
    const pic = table[0]?.imageBrief;
    // The picture takes the right half when the title fits beside it; otherwise the title stands alone.
    const split = pic ? fitsPlanned(spec, { variant: "split", stepDown: 0 }).ok : false;
    const drawnTitle = split
      ? materialiseSlide(spec, themeId, codeMeta(), deps.ids, "split")
      : materialiseSlide(spec, themeId, codeMeta(), deps.ids);
    lesson = { ...lesson, slides: [{ ...drawnTitle, id: title.id }] };
    const imageBrief: ImageBrief | undefined =
      split && pic
        ? {
            subject: pic.subject.slice(0, 60),
            mustShow: pic.mustShow.slice(0, 3).map((m) => m.slice(0, 60)),
            purpose: "context",
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
      photoCounts.requested += 1;
      const titleOutline = outline.map((e, i) => (i === 0 ? { ...e, imageBrief } : e));
      const pickLesson: Lesson = { ...lesson, facts: { ...baseFacts, outline: titleOutline } };
      titlePhotos.push(
        pickPhoto(pickLesson, 0, deps).then((picked) => {
          if (picked.outcome === "placed") {
            photoCounts.placed += 1;
            placePhoto(0, picked.photo);
          } else {
            const t = lesson.slides[0]?.elements.find((e) => e.type === "image");
            if (t) findings.push(emptyFinding(title.id, t.id));
          }
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

  const placePhoto = (index: number, photo: PlacedPhoto) => {
    const put = (slide: Slide): Slide => ({
      ...slide,
      elements: slide.elements.map((e) =>
        e.type === "image" && e.src === PLACEHOLDER_IMAGE ? withPhoto(e, photo) : e,
      ),
    });
    writing = writing.then(async () => {
      const slide = lesson.slides[index];
      if (slide) {
        lesson = { ...lesson, slides: lesson.slides.map((s, i) => (i === index ? put(s) : s)) };
        if (!deps.signal.aborted) await deps.persist(withUsage(lesson, deps));
      } else {
        const waiting = ready.get(index);
        if (waiting) ready.set(index, put(waiting));
      }
    });
  };

  const drawn = (form: string, layout: string, out: Written, meta: MaterialiseMeta): Slide => {
    const r = renderWritten(form, layout, out);
    const slide = materialiseSlide(r.spec, themeId, meta, deps.ids, r.variant, r.structure);
    if (isSetForm(form)) return withAnswersReveal(slide, themeId);
    // A diagram slot's spec is drawn by the diagram renderer; one that does not draw keeps the slot.
    const spec = form === "diagram-slot" ? out.diagram : undefined;
    return spec && typeof spec === "object"
      ? withDiagramDrawn(slide, getTheme(themeId), spec)
      : slide;
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
    const slide = drawn(s.form, s.layout, fitted.out, {
      promptVersion: WRITE_SLIDES_VERSION,
      model: modelId,
      at: at(),
    });
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
        ? (fitted.out.imageBrief as { subject: string; mustShow?: string[] } | undefined)
        : undefined;
    const imageBrief: ImageBrief | undefined = brief0
      ? {
          subject: brief0.subject.slice(0, 60),
          mustShow: (brief0.mustShow ?? []).slice(0, 3).map((m) => m.slice(0, 60)),
          purpose: "context",
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
      photoCounts.requested += 1;
      const pickLesson: Lesson = { ...lesson, facts: { ...baseFacts, outline } };
      photos.push(
        pickPhoto(pickLesson, index, deps).then((picked) => {
          if (picked.outcome === "placed") {
            photoCounts.placed += 1;
            placePhoto(index, picked.photo);
          } else {
            const t = slide.elements.find((e) => e.type === "image");
            if (t) findings.push(emptyFinding(slide.id, t.id));
          }
        }),
      );
    }
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
      if (header && deps.onLiveSlide && slides.length > 0) {
        live.latest = { i: slides.length - 1, raw: slides[slides.length - 1] };
        live.timer ??= setTimeout(sendLive, LIVE_MS);
      }
    };
    /** Live writing: the in-progress slide, drawn with blanks, at most every `LIVE_MS`. */
    const live: { latest?: { i: number; raw: unknown }; timer?: ReturnType<typeof setTimeout> } =
      {};
    const sendLive = () => {
      live.timer = undefined;
      const at = live.latest;
      if (!at || !deps.onLiveSlide || deps.signal.aborted) return;
      const n = at.i + 1 + FIXED_SLIDES;
      if (landed.has(n) || n > slideCount) return;
      const raw = at.raw && typeof at.raw === "object" ? (at.raw as Record<string, unknown>) : {};
      const kinded = formOfKind(raw.kind, menu);
      if (!kinded) return;
      let slide: Slide | undefined;
      try {
        let k = 0;
        const r = renderWritten(
          kinded.form,
          kinded.layout,
          liveFields(kinded.form, kinded.layout, raw),
        );
        slide = materialiseSlide(
          r.spec,
          themeId,
          codeMeta(),
          () => `live-${n}-${k++}`,
          r.variant,
          r.structure,
        );
      } catch {
        slide = undefined;
      }
      try {
        deps.onLiveSlide({ index: n - 1, kind: String(raw.kind), ...(slide ? { slide } : {}) });
      } catch {
        /* Live writing never stops the lesson. */
      }
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
      if (live.timer) clearTimeout(live.timer);
      live.timer = undefined;
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

  if (mode === "stream") await runStream();
  else {
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

  // Facts from what the slides show, in slide order.
  const counters: Record<string, number> = {};
  const next = (prefix: string) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}${counters[prefix]}`;
  };
  const facts: LessonFacts = {
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
  const refsOf = new Map<number, string[]>();
  for (const p of [...placed].sort((a, b) => a.index - b.index)) {
    const f = factsOfWritten(p.plan.form, p.out, objectiveIds(p.plan), next);
    facts.keyIdeas?.push(...f.keyIdeas);
    facts.questions.push(...f.questions);
    facts.workedExamples.push(...f.workedExamples);
    facts.vocabulary.push(...f.vocabulary);
    retrieval.push(...f.retrieval);
    const refs = [...f.keyIdeas, ...f.questions, ...f.workedExamples, ...f.vocabulary].map(
      (x) => x.id,
    );
    refsOf.set(p.index, refs);
    const entry = outline[p.index];
    if (entry) entry.factRefs = [...entry.factRefs, ...refs];
  }
  if (retrieval.length > 0) facts.retrieval = retrieval;

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

  // Verify after the save, beside the photo searches: a correction is written into the slides
  // that show it and lands only when the slide still fits in its own form.
  const verify = { corrections: 0, refitted: 0, rejected: 0 };
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
  let finalFacts = facts;
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
      const fresh = drawn(p.plan.form, p.plan.layout, fitted.out, {
        promptVersion: joinVersions(WRITE_SLIDES_VERSION, verifyFactsPrompt.version),
        model: "verify",
        at: at(),
      });
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
  };
  deps.logger.info({ stage: "generate", planWrite: summary }, "plan-write report");
  return { ...state, lesson };
}
