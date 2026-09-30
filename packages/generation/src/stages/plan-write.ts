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
  type MaterialiseMeta,
  materialiseSlide,
  PLACEHOLDER_IMAGE,
} from "@tj/slides";
import { z } from "zod";
import { callStructured } from "../call";
import { blocking, checkPlan, type PlanCheck } from "../plan-write/check";
import { fitWithRewrite, renderWritten, type Written } from "../plan-write/fit";
import { contractFor, isSetForm, planMenu, slideWriterSchema } from "../plan-write/menu";
import { PLAN_WRITE_VERSION } from "../plan-write/steps";
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
  WRITE_SLIDES_VERSION,
  type WriteSlidesInput,
  type WriteSlideTarget,
  writeSlidesPrompt,
} from "../prompts/write-slides";
import { type PipelineDeps, type PipelineState, StageFailure, throwIfAborted } from "../types";
import { agendaTitleSpec, VERIFY_EFFORT } from "./designer";
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
  const facts: LessonFacts = {
    objectives,
    vocabulary: [],
    workedExamples: [],
    questions: [],
    misconceptions: [
      {
        id: "m1",
        belief: plan.misconception,
        correction: "",
        objectiveRefs: objectives.map((o) => o.id),
      },
    ],
    outline: [],
    durationMin: brief.durationMin,
    slidePlan: record as unknown as Record<string, unknown>,
  };
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
    shrunk?: boolean;
  }[];
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
  const parsed = SlidePlanRecordSchema.safeParse(base.facts?.slidePlan);
  if (!parsed.success)
    throw new StageFailure("generate", "plan-write: the lesson has no slide table");
  const record = parsed.data;
  const table = record.plan.slides;
  const objectives = base.facts?.objectives ?? [];
  const slideCount = table.length;
  const themeId = base.themeId;
  const cls = planClassFor(base, deps);
  const audience = audienceOf(base);
  const startedAt = Date.parse(generationOf(base).startedAt ?? "") || Date.now();
  const at = () => deps.now().toISOString();
  const findings: Finding[] = [...generationOf(base).findings];
  const codeMeta = (): MaterialiseMeta => ({
    promptVersion: PLAN_WRITE_VERSION,
    model: CODE_MODEL,
    at: at(),
  });
  const objectiveIds = (s: PlanSlide) => {
    const ids = s.objectives.flatMap((n) =>
      objectives[n - 1] ? [objectives[n - 1]?.id as string] : [],
    );
    return ids.length > 0 ? ids : [objectives[0]?.id ?? "o1"];
  };

  // The title with the objectives (the only fixed slide), keeping the saved title's id.
  const [title] = base.slides;
  if (!title) throw new Error("plan-write: the plan step has not run");
  const agenda = agendaTitleSpec(base, objectives);
  if (!fitsPlanned(agenda, { stepDown: 1 }).ok) {
    findings.push({
      check: "fit",
      severity: "warning",
      target: { slideId: title.id },
      message:
        "This slide does not fit the save gate: the title with its objectives fails on some themes.",
    });
  }
  let lesson: Lesson = {
    ...base,
    slides: [{ ...materialiseSlide(agenda, themeId, codeMeta(), deps.ids), id: title.id }],
    fitVersion: FIT_VERSION,
  };
  const outline: OutlineEntry[] = table.map((_, i) => ({
    id: `s${i + 1}`,
    kind: "content",
    factRefs: [],
  }));
  outline[0] = { id: "s1", kind: "title", factRefs: objectives.map((o) => o.id) };

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
    return isSetForm(form) ? withAnswersReveal(slide, themeId) : slide;
  };

  /** One written slide: fitted (one re-write of a failing field), drawn, queued, photo searched. */
  const land = async (n: number, out: Written, modelId: string) => {
    const index = n - 1;
    const s = table[index] as PlanSlide;
    const fitted = await fitWithRewrite(s.form, s.layout, out, async (field, failure) => {
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
    report.push({
      slide: n,
      form: s.form,
      layout: s.layout,
      fits: fitted.fit.ok,
      ...(fitted.rewritten ? { rewritten: fitted.rewritten } : {}),
      ...(fitted.shrunk ? { shrunk: true } : {}),
    });
    placed.push({ index, plan: s, out: fitted.out });
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
      const pickLesson: Lesson = { ...lesson, facts: { ...(base.facts as LessonFacts), outline } };
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

  /** A batch whose writer failed twice: each slide asks about its purpose, flagged. */
  const landMissing = async (n: number) => {
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

  const numbers = table.map((_, i) => i + 1).filter((n) => n > 1);
  await Promise.all(batchesOf(numbers).map(runBatch));
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
    ...(base.facts as LessonFacts),
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
            planned: joinVersions(PLAN_WRITE_VERSION, verifyFactsPrompt.version),
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
    failedBatches,
    ...(firstSlideMs !== undefined ? { firstSlideMs } : {}),
    editableMs,
    verify,
    photos: photoCounts,
  };
  deps.logger.info({ stage: "generate", planWrite: summary }, "plan-write report");
  return { ...state, lesson };
}
