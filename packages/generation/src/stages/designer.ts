import { safeError } from "@tj/domain";
import {
  DEFAULT_SLIDE_COUNT,
  type FactQuestion,
  type Finding,
  type ImageBrief,
  type KeyIdea,
  type Lesson,
  type LessonFacts,
  type Objective,
  type OutlineEntry,
  type Slide,
  type VocabularyItem,
  type WorkedExample,
} from "@tj/domain/documents";
import {
  FIT_VERSION,
  type MaterialiseMeta,
  materialiseSlide,
  PLACEHOLDER_IMAGE,
  paletteMenu,
  type SlideSpec,
  slideFits,
  THEMES,
} from "@tj/slides";
import type { z } from "zod";
import * as zod from "zod";
import { callStructured } from "../call";
import {
  CHECK_FORMS,
  CODE_MODEL,
  codedSetSpec,
  designMinimums,
  exitStemLine,
  questionLine,
  renderSlot,
  withAnswersReveal,
} from "../planner/coded-slides";
import { allocate, type CycleSlots } from "../planner/cycles";
import { fitSlot, type SlotFit } from "../planner/slot-fit";
import { verifyFactsPrompt } from "../prompts";
import {
  type DesignCycleOutput,
  type DesignSlot,
  designCyclePrompt,
  designCycleSchemaFor,
  ExitQuestionSchema,
  type SlotForm,
} from "../prompts/design-cycle";
import { ObjectiveArcSchema } from "../prompts/plan-objectives";
import {
  BudgetExceeded,
  callContext,
  type DesignReport,
  type PipelineDeps,
  type PipelineState,
  StageFailure,
  throwIfAborted,
} from "../types";
import { withUsage } from "./generate";
import { emptyFinding, joinVersions, type PlacedPhoto, pickPhoto, withPhoto } from "./illustrate";
import { runObjectivesStep } from "./objectives";
import { DESIGNER_VERSION } from "./objectives-first";
import { existingTitle, materialiseTitle } from "./plan";
import { audienceOf, generationOf, planClassFor, shapeOf } from "./shared";
import { runVerify } from "./verify";

/*
 * The lesson designer's two steps (the lesson designer plan, pipeline steps 1–6; TEACH-199,
 * TEACH-208). `designerObjectives`: the title slide saved before any call, then plan-objectives
 * (objectives, arc and starter questions), stamped as the designer's. `design`: allocation, one
 * streamed design-cycle call per objective in parallel, each slot fitted (`fitSlot`: the gate and
 * the fallback order) and saved as soon as it and every slide before it are in; the starter, the
 * objectives and the exit ticket are printed in code; photographs are searched as their slots
 * land; Verify runs over the designed material after the deck is saved, and a correction is
 * re-fitted before it replaces a slide. The count is fixed at allocation: a cycle that fails
 * leaves its slots as open questions on its objective, never a shorter deck.
 */

const PROGRESS_STARTING = 2;
const PROGRESS_SLIDES_FROM = 10;
const PROGRESS_SLIDES_SPAN = 70;
const PROGRESS_GENERATED = PROGRESS_SLIDES_FROM + PROGRESS_SLIDES_SPAN;
/** Output cap of one design cycle: slots plus low-effort reasoning (smoke r7: 1.5–3k used). */
export const MAX_OUTPUT_TOKENS_DESIGN = 8000;
/** A single-slot re-fill (rung 4). */
const MAX_OUTPUT_TOKENS_REFILL = 3000;

type Arc = NonNullable<PipelineState["designArcs"]>[number];

/* ------------------------------------------------------------------ objectives */

/**
 * The designer's objectives step: the title slide first (the plan's ~1 s slide), then the
 * objectives call; the checkpoint carries the designer's stamp and the arcs are saved on the
 * objectives (and ride on the state for a one-pass run).
 */
export async function designerObjectives(
  state: PipelineState,
  deps: PipelineDeps,
): Promise<PipelineState> {
  let lesson = state.lesson;
  if (!existingTitle(lesson)) {
    const { generation: _none, ...bare } = lesson;
    lesson = { ...bare, slides: [materialiseTitle(bare, deps)] };
    const { updatedAt } = await deps.persist(lesson);
    await deps.onProgress(PROGRESS_STARTING, "Title ready", "plan", updatedAt);
  }
  const { state: next, report } = await runObjectivesStep({ ...state, lesson }, deps);
  const generation = generationOf(next.lesson);
  const arcs = report.objectives.map((o) => (o as { arc?: Arc }).arc);
  const facts = next.lesson.facts;
  const planned: Lesson = {
    ...next.lesson,
    ...(facts ? { facts: { ...facts, objectives: withArcs(facts.objectives, arcs) } } : {}),
    generation: {
      ...generation,
      promptVersions: { ...generation.promptVersions, planned: DESIGNER_VERSION },
    },
  };
  await deps.persist(planned);
  return { ...next, lesson: planned, designArcs: arcs };
}

/**
 * The objectives with the call's arcs saved on them, by position, so the design step (its own job
 * after the teacher confirms the plan) designs from them. A pinned re-plan writes no arcs: the
 * objectives keep the ones they have.
 */
export function withArcs(objectives: readonly Objective[], arcs: readonly (Arc | undefined)[]) {
  return objectives.map((o, i) => {
    const arc = arcs[i];
    return arc
      ? { ...o, arc: { angle: arc.angle, lean: arc.lean, misconception: arc.misconception } }
      : o;
  });
}

/**
 * Each objective's arc for the design step: the one saved on the objective (checked against the
 * arc schema: a stored lean the palette no longer has is dropped), else the one handed on in-process.
 */
export function arcsFor(
  objectives: readonly Objective[],
  handed: readonly (Arc | undefined)[] | undefined,
): (Arc | undefined)[] {
  return objectives.map((o, i) => {
    const stored = o.arc ? ObjectiveArcSchema.safeParse(o.arc) : undefined;
    return stored?.success ? stored.data : handed?.[i];
  });
}

/* ------------------------------------------------------------------ facts from slots */

type Bound = { slide: number; objective: number; slot: DesignSlot; fit: SlotFit };

/** The slot's material as facts, so Verify, Evaluate and Repair read what the slide says. */
function factsOfSlot(
  b: Bound,
  objectiveId: string,
  next: (prefix: string) => string,
): {
  keyIdeas: KeyIdea[];
  questions: FactQuestion[];
  workedExamples: WorkedExample[];
  vocabulary: VocabularyItem[];
} {
  const s = b.fit.slot;
  const out = {
    keyIdeas: [] as KeyIdea[],
    questions: [] as FactQuestion[],
    workedExamples: [] as WorkedExample[],
    vocabulary: [] as VocabularyItem[],
  };
  const refs = [objectiveId];
  switch (s.form) {
    case "explain":
    case "explain-callout":
    case "list":
    case "compare":
    case "sequence":
    case "photo":
    case "figure":
    case "diagram-slot":
      out.keyIdeas.push({
        id: next("k"),
        statement: s.heading,
        explanation: s.body,
        example: "",
        objectiveRefs: refs,
      });
      break;
    case "worked-example":
      out.workedExamples.push({
        id: next("x"),
        problem: s.question,
        steps: s.steps,
        answer: s.steps[s.steps.length - 1] ?? "",
        objectiveRefs: refs,
      });
      break;
    case "hinge": {
      const right = s.options.find((o) => o.correct);
      out.questions.push({
        id: next("q"),
        stem: s.stem,
        answer: right?.text ?? "",
        reasoning: s.explanation,
        objectiveRefs: refs,
        distractors: s.options.filter((o) => !o.correct).map((o) => ({ text: o.text })),
        use: "slide",
      });
      break;
    }
    case "true-false":
      out.questions.push({
        id: next("q"),
        stem: s.statement,
        answer: s.correct ? "True" : "False",
        reasoning: s.explanation,
        objectiveRefs: refs,
        use: "slide",
      });
      break;
    case "open-response":
      out.questions.push({
        id: next("q"),
        stem: s.stem,
        answer: s.modelAnswer,
        reasoning: "",
        objectiveRefs: refs,
        use: "slide",
      });
      break;
    case "vocabulary":
      for (const e of s.entries) {
        out.vocabulary.push({
          id: next("v"),
          term: e.term,
          definition: e.definition,
          objectiveRefs: refs,
        });
      }
      break;
    default:
      break;
  }
  return out;
}

/** A slot rebuilt from its (Verify-corrected) facts; `undefined` when nothing it shows changed. */
function slotFromFacts(slot: DesignSlot, facts: LessonFacts, refs: string[]): DesignSlot {
  const ref = new Set(refs);
  const k = (facts.keyIdeas ?? []).find((f) => ref.has(f.id));
  const q = facts.questions.find((f) => ref.has(f.id));
  const x = facts.workedExamples.find((f) => ref.has(f.id));
  const v = facts.vocabulary.filter((f) => ref.has(f.id));
  switch (slot.form) {
    case "explain":
    case "explain-callout":
    case "list":
    case "compare":
    case "sequence":
    case "photo":
    case "figure":
    case "diagram-slot":
      return k ? { ...slot, heading: k.statement, body: k.explanation } : slot;
    case "worked-example":
      return x ? { ...slot, question: x.problem, steps: x.steps.slice(0, 3) } : slot;
    case "hinge": {
      if (!q) return slot;
      let wrong = 0;
      const distractors = q.distractors ?? [];
      return {
        ...slot,
        stem: q.stem,
        explanation: q.reasoning,
        options: slot.options.map((o) =>
          o.correct
            ? { ...o, text: q.answer }
            : { ...o, text: distractors[wrong++]?.text ?? o.text },
        ),
      };
    }
    case "true-false":
      return q ? { ...slot, statement: q.stem, explanation: q.reasoning } : slot;
    case "open-response":
      return q ? { ...slot, stem: q.stem, modelAnswer: q.answer } : slot;
    case "vocabulary":
      return v.length === slot.entries.length
        ? { ...slot, entries: v.map((e) => ({ term: e.term, definition: e.definition })) }
        : slot;
    default:
      return slot;
  }
}

/** The outline kind a rendered slot is (the entry illustrate and repair read). */
function kindOf(spec: SlideSpec): OutlineEntry["kind"] {
  return spec.kind as OutlineEntry["kind"];
}

/** A photo slot's brief for the stock search: the domain's caps are a search query's, not text on a slide. */
function imageBriefOf(slot: DesignSlot): ImageBrief | undefined {
  if (slot.form !== "photo") return undefined;
  return {
    subject: slot.imageBrief.subject.slice(0, 60),
    mustShow: (slot.imageBrief.mustShow ?? []).slice(0, 3).map((m) => m.slice(0, 60)),
    purpose: "context",
  };
}

/* ------------------------------------------------------------------ question sets */

/** A set spec with its answers in the notes and no reveal strip (the answers' whole unit moved). */
function withAnswersInNotes(spec: SlideSpec, answers: readonly string[]): SlideSpec {
  const { footnote: _strip, ...rest } = spec as SlideSpec & { footnote?: string };
  const listed = answers.map((a, i) => `${i + 1}. ${a}`).join(" ");
  const notes = [spec.notes, listed ? `Answers: ${listed}` : ""].filter(Boolean).join("\n");
  return { ...rest, notes } as SlideSpec;
}

const SET_META: MaterialiseMeta = {
  promptVersion: "fit",
  model: CODE_MODEL,
  at: "1970-01-01T00:00:00.000Z",
};

/**
 * A question set as it is stored — materialised, its answers turned into the reveal — fits every
 * theme at the save gate's step, answers clear of the questions included (`slideFits`).
 */
export function setFits(spec: SlideSpec): boolean {
  return THEMES.every(
    (theme) =>
      slideFits(withAnswersReveal(materialiseSlide(spec, theme.id, SET_META), theme.id), theme, 1)
        .ok,
  );
}

/** The set as printed when its reveal fits every theme; otherwise its answers in the notes. */
function answersToNotesUnlessFit(spec: SlideSpec, answers: readonly string[]): SlideSpec {
  if (answers.length === 0 || setFits(spec)) return spec;
  const moved = withAnswersInNotes(spec, answers);
  return setFits(moved) ? moved : spec;
}

/** Every exit line, one per question ref, with the answers in the notes. */
function exitTicketAll(refs: readonly string[], facts: LessonFacts): { spec: SlideSpec } {
  const lines = refs.flatMap((id) => {
    const q = facts.questions.find((x) => x.id === id);
    return q ? [q.use === "exit" ? questionLine(q) : exitStemLine(q)] : [];
  });
  const spec: SlideSpec = {
    kind: "exit-ticket",
    factRefs: [...refs],
    heading: "Exit ticket",
    items: lines.map((l) => l.text),
  };
  return {
    spec: withAnswersInNotes(
      spec,
      lines.map((l) => l.answer),
    ),
  };
}

/* ------------------------------------------------------------------ design */

export async function design(state: PipelineState, deps: PipelineDeps): Promise<PipelineState> {
  const base = state.lesson;
  const brief = base.brief;
  if (!brief) throw new Error("design: the lesson has no brief");
  const objectives = base.facts?.objectives ?? [];
  if (objectives.length === 0)
    throw new StageFailure("generate", "design: the lesson has no objectives");
  const startedAt = Date.parse(generationOf(base).startedAt ?? "") || Date.now();
  const themeId = base.themeId;
  const subject = base.subject;
  const slideCount = brief.slideCount ?? DEFAULT_SLIDE_COUNT;
  const arcs = arcsFor(objectives, state.designArcs);
  const allocation = allocate(slideCount, arcs);
  const audience = audienceOf(base);
  const shape = shapeOf(base);
  const cls = planClassFor(base, deps);
  const palette = paletteMenu(subject);
  const findings: Finding[] = [...generationOf(base).findings];
  const at = () => deps.now().toISOString();
  const codeMeta = (): MaterialiseMeta => ({
    promptVersion: DESIGNER_VERSION,
    model: CODE_MODEL,
    at: at(),
  });
  deps.logger.info(
    {
      stage: "generate",
      call: "allocate",
      slideCount,
      cycles: allocation.cycles.map((c) => c.count),
      short: allocation.short,
    },
    "designer allocation",
  );

  // The deck restarts from the title and objectives: a design step that stopped part-way is redone.
  const [title, objectivesSlide] = base.slides;
  if (!title || !objectivesSlide) throw new Error("design: the objectives step has not run");
  let lesson: Lesson = { ...base, slides: [title, objectivesSlide], fitVersion: FIT_VERSION };
  const retrieval = base.facts?.retrieval ?? [];
  const facts0: LessonFacts = {
    objectives,
    vocabulary: [],
    workedExamples: [],
    questions: [],
    misconceptions: arcs.flatMap((arc, i) =>
      arc
        ? [
            {
              id: `m${i + 1}`,
              belief: arc.misconception,
              correction: "",
              objectiveRefs: [objectives[i]?.id ?? "o1"],
            },
          ]
        : [],
    ),
    outline: [],
    durationMin: base.facts?.durationMin ?? brief.durationMin,
    ...(retrieval.length > 0 ? { retrieval } : {}),
  };
  const outline: OutlineEntry[] = Array.from({ length: slideCount }, (_, i) => ({
    id: `s${i + 1}`,
    kind: "content",
    factRefs: [],
  }));
  outline[0] = { id: "s1", kind: "title", factRefs: [] };
  outline[1] = {
    id: "s2",
    kind: "objectives",
    factRefs: objectives.map((o) => o.id),
    phase: "starter",
  };

  // Persist in slide order, one write at a time; `ready` holds slides waiting for an earlier one.
  const ready = new Map<number, Slide>();
  let writing: Promise<void> = Promise.resolve();
  let firstSlotMs: number | undefined;
  const cycleSlides = new Set<number>();
  const flush = () => {
    writing = writing.then(async () => {
      let wrote = false;
      while (ready.has(lesson.slides.length)) {
        const index = lesson.slides.length;
        const slide = ready.get(index) as Slide;
        ready.delete(index);
        lesson = { ...lesson, slides: [...lesson.slides, slide] };
        if (firstSlotMs === undefined && cycleSlides.has(index))
          firstSlotMs = Date.now() - startedAt;
        wrote = true;
      }
      if (!wrote || deps.signal.aborted) return;
      const { updatedAt } = await deps.persist(withUsage(lesson, deps));
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

  // The starter, in code: the objectives call's retrieval questions, answers revealed.
  const starterEntry: OutlineEntry = { id: "s3", kind: "starter", factRefs: [], phase: "starter" };
  outline[2] = starterEntry;
  const starterCoded = codedSetSpec(starterEntry, facts0, `${base.id}:2`);
  const starterSpec: SlideSpec = starterCoded?.spec ?? {
    kind: "starter",
    factRefs: [],
    heading: "Do now",
    items: [`What do you already know about ${brief.topic}?`],
  };
  const starterFitted = answersToNotesUnlessFit(starterSpec, starterCoded?.answers ?? []);
  if (starterFitted !== starterSpec) {
    deps.logger.info(
      { stage: "generate", slide: 3, rung: "notes" },
      "starter answers moved to the notes",
    );
  }
  ready.set(
    2,
    withAnswersReveal(materialiseSlide(starterFitted, themeId, codeMeta(), deps.ids), themeId),
  );
  void flush();

  // Photos, searched as their slots land; placed into the slide once it is saved.
  const photos: Promise<void>[] = [];
  const photoCounts = { requested: 0, placed: 0 };
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

  // The cycles, in parallel and streamed.
  const bound: Bound[] = [];
  const exitQuestions: (DesignCycleOutput["exitQuestion"] | undefined)[] = objectives.map(
    () => undefined,
  );
  const failedCycles: number[] = [];
  const refillFor = (cycle: CycleSlots, k: number) => async (slot: DesignSlot, form: SlotForm) => {
    const union = designCycleSchemaFor(subject, 1).shape.slots.element as unknown as {
      options: z.ZodObject[];
    };
    const only = union.options.find(
      (o) => (o.shape.form as unknown as { value: string }).value === form,
    );
    if (!only) return undefined;
    const call = await callStructured({
      deps,
      stage: "generate",
      cls,
      effort: "low",
      prompt: designCyclePrompt,
      input: {
        topic: brief.topic,
        shape,
        audience,
        objectives: objectives.map((o, i) => ({ text: o.text, arc: arcs[i] as never })),
        objectiveIndex: cycle.objective,
        slots: { count: 1, first: cycle.first + k, slideCount },
        palette,
      },
      schema: zod.object({ slots: only.array().length(1), exitQuestion: ExitQuestionSchema }),
      maxOutputTokens: MAX_OUTPUT_TOKENS_REFILL,
    });
    deps.logger.info(
      { stage: "generate", call: "refill", from: slot.form, to: form },
      "designer refill",
    );
    return (call.output as unknown as { slots: DesignSlot[] }).slots[0];
  };

  const landSlot = async (cycle: CycleSlots, k: number, slot: DesignSlot, modelId: string) => {
    const index = cycle.first - 1 + k;
    if (cycleSlides.has(index)) return;
    cycleSlides.add(index);
    const fit = await fitSlot(slot, {
      seed: `${base.id}:${index}`,
      themeId,
      refill: refillFor(cycle, k),
    });
    const b: Bound = { slide: index, objective: cycle.objective, slot, fit };
    bound.push(b);
    const slide = renderSlot(
      fit.render,
      themeId,
      { promptVersion: designCyclePrompt.version, model: modelId, at: at() },
      deps.ids,
    );
    const imageBrief = imageBriefOf(fit.slot);
    outline[index] = {
      id: `s${index + 1}`,
      kind: kindOf(fit.render.spec),
      factRefs: [objectives[cycle.objective]?.id ?? "o1"],
      brief: {
        adds: "heading" in fit.slot ? fit.slot.heading : "stem" in fit.slot ? fit.slot.stem : "",
      },
      phase: CHECK_FORMS.has(fit.slot.form) ? "check" : "explain",
      ...(imageBrief ? { imageBrief } : {}),
      ...(fit.render.spec.kind === "content" && fit.render.spec.callout
        ? {
            callout: {
              kind: fit.render.spec.callout.kind,
              factRefs: [objectives[cycle.objective]?.id ?? "o1"],
            },
          }
        : {}),
      ...(fit.slot.form === "figure"
        ? {
            figureBrief: {
              template: fit.slot.figureBrief.template,
              purpose: fit.slot.figureBrief.purpose.slice(0, 160),
            },
          }
        : {}),
    };
    ready.set(index, slide);
    void flush();
    if (imageBrief && deps.images) {
      photoCounts.requested += 1;
      const pickLesson: Lesson = { ...lesson, facts: { ...facts0, outline } };
      photos.push(
        pickPhoto(pickLesson, index, deps).then((picked) => {
          if (picked.outcome === "placed") {
            photoCounts.placed += 1;
            placePhoto(index, picked.photo);
          } else {
            const target = slide.elements.find((e) => e.type === "image");
            if (target) findings.push(emptyFinding(slide.id, target.id));
          }
        }),
      );
    }
  };

  const runCycle = async (cycle: CycleSlots) => {
    if (cycle.count === 0) return;
    const schema = designCycleSchemaFor(subject, cycle.count);
    const slotSchema = schema.shape.slots.element;
    const landing: Promise<void>[] = [];
    let modelId = "unknown";
    const land = (k: number, raw: unknown) => {
      const parsed = slotSchema.safeParse(raw);
      if (parsed.success) landing.push(landSlot(cycle, k, parsed.data as DesignSlot, modelId));
    };
    try {
      throwIfAborted(deps.signal);
      modelId = (() => {
        const routed = deps.ai.model(
          cls,
          callContext(deps, "generate", designCyclePrompt.version, "low"),
        );
        return typeof routed === "string" ? routed : routed.modelId;
      })();
      deps.logger.info(
        { stage: "generate", call: "design-cycle", objective: cycle.objective, slots: cycle.count },
        "plan call",
      );
      const call = await callStructured({
        deps,
        stage: "generate",
        cls,
        effort: "low",
        prompt: designCyclePrompt,
        input: {
          topic: brief.topic,
          shape,
          audience,
          objectives: objectives.map((o, i) => ({ text: o.text, arc: arcs[i] as never })),
          objectiveIndex: cycle.objective,
          slots: { count: cycle.count, first: cycle.first, slideCount },
          palette,
        },
        schema,
        maxOutputTokens: MAX_OUTPUT_TOKENS_DESIGN,
        // A slot is complete once the next one has started (or the exit question has).
        onPartial: (partial) => {
          const p = partial as { slots?: unknown[]; exitQuestion?: unknown } | undefined;
          const slots = p?.slots ?? [];
          const done = p?.exitQuestion !== undefined ? slots.length : slots.length - 1;
          for (let k = 0; k < Math.min(done, cycle.count); k++) {
            if (!cycleSlides.has(cycle.first - 1 + k)) land(k, slots[k]);
          }
        },
      });
      modelId = call.modelId;
      const output = call.output as DesignCycleOutput;
      output.slots.forEach((slot, k) => {
        if (!cycleSlides.has(cycle.first - 1 + k)) landing.push(landSlot(cycle, k, slot, modelId));
      });
      exitQuestions[cycle.objective] = output.exitQuestion;
    } catch (error) {
      if (!(error instanceof BudgetExceeded) && !(error instanceof StageFailure)) {
        if (error instanceof Error && error.name === "AbortError") throw error;
      }
      failedCycles.push(cycle.objective);
      deps.logger.warn(
        {
          stage: "generate",
          call: "design-cycle",
          objective: cycle.objective,
          err: safeError(error),
        },
        "design cycle failed; its slots are open questions on the objective",
      );
    }
    await Promise.all(landing);
    // Whatever did not land (a failed call) keeps the count: the objective as an open question.
    for (let k = 0; k < cycle.count; k++) {
      const index = cycle.first - 1 + k;
      if (cycleSlides.has(index)) continue;
      const text = objectives[cycle.objective]?.text ?? brief.topic;
      await landSlot(cycle, k, { form: "discussion", prompt: text }, CODE_MODEL);
      findings.push({
        check: "missing-material",
        severity: "warning",
        target: {},
        message: `Objective ${cycle.objective + 1} could not be designed; slide ${index + 1} asks about it instead.`,
      });
    }
  };

  await Promise.all(allocation.cycles.map(runCycle));
  throwIfAborted(deps.signal);

  // Facts from what the slides show: ids per slot, for Verify, Evaluate and Repair.
  const counters: Record<string, number> = {};
  const next = (prefix: string) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}${counters[prefix]}`;
  };
  const facts: LessonFacts = { ...facts0, keyIdeas: [] };
  const refsOf = new Map<number, string[]>();
  for (const b of [...bound].sort((x, y) => x.slide - y.slide)) {
    const oid = objectives[b.objective]?.id ?? "o1";
    const f = factsOfSlot(b, oid, next);
    facts.keyIdeas?.push(...f.keyIdeas);
    facts.questions.push(...f.questions);
    facts.workedExamples.push(...f.workedExamples);
    facts.vocabulary.push(...f.vocabulary);
    const refs = [
      ...f.keyIdeas.map((x) => x.id),
      ...f.questions.map((x) => x.id),
      ...f.workedExamples.map((x) => x.id),
      ...f.vocabulary.map((x) => x.id),
    ];
    refsOf.set(b.slide, refs);
    const entry = outline[b.slide];
    if (entry) entry.factRefs = [oid, ...refs];
  }

  // The exit ticket, in code: one line per objective from its exit question, or its first check's
  // stem when the cycle wrote none (`codedSetSpec` prints a non-exit question as a stem).
  const exitRefs: string[] = [];
  objectives.forEach((o, i) => {
    const eq = exitQuestions[i];
    if (eq) {
      const id = next("q");
      facts.questions.push({
        id,
        stem: eq.question,
        answer: eq.answer,
        reasoning: "",
        objectiveRefs: [o.id],
        use: "exit",
      });
      exitRefs.push(id);
      return;
    }
    const check = facts.questions.find((q) => q.use === "slide" && q.objectiveRefs?.includes(o.id));
    if (check) exitRefs.push(check.id);
  });
  const exitIndex = slideCount - 1;
  const exitEntry: OutlineEntry = {
    id: `s${slideCount}`,
    kind: "exit-ticket",
    factRefs: exitRefs,
    phase: "check",
  };
  outline[exitIndex] = exitEntry;
  facts.outline = outline;
  const exitCoded = codedSetSpec(exitEntry, facts, `${base.id}:${exitIndex}`);
  // One line per objective: when the reveal strip crowds a line off, every line is printed and the
  // answers move to the notes, word for word (rung 3 on the ticket), if that fits.
  const exitAll = exitTicketAll(exitRefs, facts);
  let exitSpec: SlideSpec = exitCoded?.spec ?? exitAll.spec;
  let exitPrinted = exitCoded?.questionRefs ?? [];
  const exitShort = exitPrinted.length < exitRefs.length || (exitCoded && !setFits(exitCoded.spec));
  if (exitShort && setFits(exitAll.spec)) {
    exitSpec = exitAll.spec;
    exitPrinted = exitRefs;
    deps.logger.info(
      { stage: "generate", slide: slideCount, rung: "notes" },
      "exit answers moved to the notes",
    );
  }
  const exitCovered = new Set(
    exitPrinted.flatMap((id) => facts.questions.find((q) => q.id === id)?.objectiveRefs ?? []),
  ).size;
  if (exitCovered < objectives.length) {
    deps.logger.warn(
      { stage: "generate", covered: exitCovered, objectives: objectives.length },
      "exit ticket misses an objective",
    );
  }
  ready.set(
    exitIndex,
    withAnswersReveal(materialiseSlide(exitSpec, themeId, codeMeta(), deps.ids), themeId),
  );
  lesson = { ...lesson, facts };
  await flush();
  await Promise.all(photos);
  await writing;
  if (lesson.slides.length !== slideCount) {
    throw new StageFailure(
      "generate",
      `design: ${lesson.slides.length} of ${slideCount} slides were written`,
    );
  }

  // Verify, after the save: corrections re-fitted before they replace a slide.
  const verifyReport = { corrections: 0, refitted: 0, rejected: 0 };
  const verified = await runVerify(facts, { topic: brief.topic, audience }, deps, cls);
  for (const f of verified.findings) {
    if (f.check === "budget" && findings.some((g) => g.check === "budget")) continue;
    findings.push(f);
  }
  let finalFacts = facts;
  if (verified.applied.length > 0) {
    verifyReport.corrections = verified.applied.length;
    finalFacts = verified.facts;
    const touched = new Set(verified.applied.map((c) => c.factId));
    for (const b of bound) {
      const refs = refsOf.get(b.slide) ?? [];
      if (!refs.some((r) => touched.has(r))) continue;
      const corrected = slotFromFacts(b.fit.slot, finalFacts, refs);
      const refit = await fitSlot(corrected, { seed: `${base.id}:${b.slide}`, themeId });
      if (refit.rung === "flagged") {
        verifyReport.rejected += 1;
        deps.logger.warn(
          { stage: "generate", slide: b.slide + 1 },
          "verify correction does not fit; kept the slide",
        );
        continue;
      }
      verifyReport.refitted += 1;
      const old = lesson.slides[b.slide] as Slide;
      const fresh = renderSlot(
        refit.render,
        themeId,
        {
          promptVersion: joinVersions(designCyclePrompt.version, verifyFactsPrompt.version),
          model: "verify",
          at: at(),
        },
        deps.ids,
      );
      const photo = old.elements.find((e) => e.type === "image" && e.src !== PLACEHOLDER_IMAGE);
      lesson = {
        ...lesson,
        slides: lesson.slides.map((s, i) =>
          i === b.slide
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
      b.fit = refit;
    }
    // The exit ticket is reprinted from the corrected facts.
    const coded = codedSetSpec(exitEntry, finalFacts, `${base.id}:${exitIndex}`);
    const reprinted =
      exitSpec === exitAll.spec || !coded
        ? { spec: exitTicketAll(exitRefs, finalFacts).spec }
        : coded;
    if (reprinted) {
      const old = lesson.slides[exitIndex] as Slide;
      const fresh = withAnswersReveal(
        materialiseSlide(reprinted.spec, themeId, codeMeta(), deps.ids),
        themeId,
      );
      lesson = {
        ...lesson,
        slides: lesson.slides.map((s, i) => (i === exitIndex ? { ...fresh, id: old.id } : s)),
      };
    }
  }

  // The code minimums, logged; nothing rewritten.
  const placed = bound.map((b) => ({
    objective: b.objective,
    form: b.fit.slot.form,
    slide: b.slide + 1,
  }));
  const minimums = designMinimums(placed, arcs);
  if (
    minimums.visualMissing.length ||
    minimums.checks < 3 ||
    minimums.sameNeighbours.length ||
    minimums.untaught.length ||
    minimums.unchecked.length
  ) {
    deps.logger.warn({ stage: "generate", minimums }, "designer minimums missed");
  }
  const rungs: Record<string, number> = {};
  for (const b of bound) rungs[b.fit.rung] = (rungs[b.fit.rung] ?? 0) + 1;
  for (const b of bound) {
    if (b.fit.rung === "flagged") {
      findings.push({
        check: "fit",
        severity: "warning",
        target: { slideId: lesson.slides[b.slide]?.id },
        message: "This slide may need its text size stepped down on some themes.",
      });
    }
  }

  const generation = generationOf(lesson);
  lesson = withUsage(
    {
      ...lesson,
      facts: { ...finalFacts, outline },
      generation: {
        ...generation,
        stage: "generated",
        promptVersions: {
          ...generation.promptVersions,
          planned: joinVersions(DESIGNER_VERSION, verifyFactsPrompt.version),
          generated: designCyclePrompt.version,
        },
        findings,
      },
    },
    deps,
  );
  const { updatedAt } = await deps.persist(lesson);
  const editableMs = Date.now() - startedAt;
  await deps.onProgress(PROGRESS_GENERATED, "Slides ready", "generate", updatedAt);

  const report: DesignReport = {
    slideCount,
    allocation: allocation.cycles.map((c) => c.count),
    short: allocation.short,
    slots: [...bound]
      .sort((x, y) => x.slide - y.slide)
      .map((b) => ({
        slide: b.slide + 1,
        objective: b.objective,
        planned: b.slot.form,
        form: b.fit.slot.form,
        rung: b.fit.rung,
        tried: b.fit.tried,
      })),
    rungs,
    minimums,
    exitCovered,
    failedCycles,
    verify: verifyReport,
    ...(firstSlotMs !== undefined ? { firstSlotMs } : {}),
    editableMs,
    photos: photoCounts,
  };
  deps.logger.info({ stage: "generate", designer: report }, "designer report");
  const { pendingVerify: _none, ...rest } = state;
  return { ...rest, lesson, designReport: report };
}
