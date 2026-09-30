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
  fitsPlanned,
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
  type Asked,
  answerSupport,
  askedOf,
  refillOpening,
  refsOfSlot,
  taughtText,
  unsupportedReason,
} from "../planner/answer-support";
import {
  CHECK_FORMS,
  CODE_MODEL,
  codedSetSpec,
  designMinimums,
  exitStemLine,
  minimumRefills,
  questionLine,
  renderSlot,
  VISUAL_FORMS,
  withAnswersReveal,
} from "../planner/coded-slides";
import { allocate, allocateR6, type CycleSlots } from "../planner/cycles";
import { fitSlot, type SlotFit } from "../planner/slot-fit";
import { verifyFactsPrompt } from "../prompts";
import {
  type DesignCycleOutput,
  type DesignSlot,
  designCyclePrompt,
  designCycleSchemaFor,
  ROLE_FORMS,
  SLOT_ROLES,
  type SlotForm,
  type SlotRole,
  slotFormsFor,
} from "../prompts/design-cycle";
import { ObjectiveArcSchema } from "../prompts/plan-objectives";
import {
  BudgetExceeded,
  callContext,
  type DesignReport,
  type DesignTimings,
  type PipelineDeps,
  type PipelineState,
  StageFailure,
  throwIfAborted,
} from "../types";
import {
  correctedSlots,
  designerFactsOn,
  type FedFacts,
  factsWords,
  startFactsFeed,
} from "./designer-facts";
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
/**
 * Output cap of one design cycle, sized to its slots: low-effort reasoning and the exit question,
 * then each slot (smoke r7: 1.5–3k used at 2–3 slots). The budget reserves this cap up front and
 * settles on the real usage, so a cap at the model maximum would refuse parallel cycles that fit.
 */
export const DESIGN_BASE_OUTPUT_TOKENS = 2000;
export const DESIGN_OUTPUT_TOKENS_PER_SLOT = 1000;
export const MAX_OUTPUT_TOKENS_DESIGN = 8000;
export const designCycleMaxOutputTokens = (slots: number): number =>
  Math.min(
    MAX_OUTPUT_TOKENS_DESIGN,
    DESIGN_BASE_OUTPUT_TOKENS + DESIGN_OUTPUT_TOKENS_PER_SLOT * slots,
  );
/**
 * Verify's effort on a designer lesson (designer prompts r1 probe, `lab/designer-prompts2/verify-probe`):
 * medium caught the planted date error with no false corrections; low rewrote correct facts into
 * hedges. It runs after the save, so the extra seconds are off the first slide's path.
 */
export const VERIFY_EFFORT = "medium" as const;
/** A single-slot re-fill (rung 4). */
const MAX_OUTPUT_TOKENS_REFILL = 3000;
/** A re-fill's exit question: `ExitQuestionSchema`'s keys, read by no one, so blanks pass. */
const REFILL_EXIT_QUESTION = zod.object({ answer: zod.string(), question: zod.string() });

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
  const { state: next, report } = await runObjectivesStep({ ...state, lesson }, deps, {
    r6: designerR6(deps),
  });
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

/** A slot's material as the re-fill is shown it: every field but its form and notes, as written. */
export function slotMaterial(slot: DesignSlot): string {
  const { form: _form, notes: _notes, ...material } = slot;
  return JSON.stringify(material);
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
export function withAnswersInNotes(spec: SlideSpec, answers: readonly string[]): SlideSpec {
  const { footnote: _strip, ...rest } = spec as SlideSpec & { footnote?: string };
  const listed = answers.map((a, i) => `${i + 1}. ${a}`).join(" ");
  const line = listed ? `Answers: ${listed}` : "";
  // `codedSetSpec` already writes this line into the set's notes: never twice (designer eval r2).
  const kept = (spec.notes ?? "")
    .split("\n")
    .filter((l) => l.trim() !== "" && l.trim() !== line)
    .join("\n");
  const notes = [kept, line].filter(Boolean).join("\n");
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

/** Why a set fails the save gate, for its flag: the themes it fails on. */
export function setFitReason(spec: SlideSpec): string {
  const failing = THEMES.filter(
    (theme) =>
      !slideFits(withAnswersReveal(materialiseSlide(spec, theme.id, SET_META), theme.id), theme, 1)
        .ok,
  );
  return `fails on ${failing.length} of ${THEMES.length} themes (${failing.map((t) => t.id).join(", ")})`;
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

/** Designer r4's objectives-on-title switch: the deps' flag, else `DESIGNER_OBJECTIVES_ON_TITLE=1`. */
export function objectivesOnTitle(deps: Pick<PipelineDeps, "objectivesOnTitle">): boolean {
  return deps.objectivesOnTitle ?? process.env.DESIGNER_OBJECTIVES_ON_TITLE === "1";
}

/**
 * Designer r6's switch (structure is not fixed: the title with the objectives is the only fixed
 * slide; opening and closing slots only when the objectives call asked for them): the deps' flag,
 * else `DESIGNER_R6=1` in the environment. Off: the r5 deck (title, objectives, starter, cycles,
 * exit ticket).
 */
export function designerR6(deps: Pick<PipelineDeps, "designerR6">): boolean {
  return deps.designerR6 ?? process.env.DESIGNER_R6 === "1";
}

/** What an r6 hook, plenary or debate asks when the objectives call wrote no prompt for it. */
export function bookendPrompt(kind: string, topic: string, prompt?: string | undefined): string {
  if (prompt?.trim()) return prompt.trim();
  if (kind === "hook") return `What do you already know about ${topic}?`;
  if (kind === "debate") return `Where do you stand on ${topic}, and why?`;
  return `What is the most important thing you learned about ${topic} today?`;
}

/**
 * The title slide with the lesson's objectives beside it (the `agenda` variant): the title and
 * class line `materialiseTitle` writes, and at most four objectives, as the objectives slide
 * would list them.
 */
export function agendaTitleSpec(lesson: Lesson, objectives: readonly Objective[]): SlideSpec {
  return {
    kind: "title",
    title: lesson.title,
    subtitle: [lesson.yearGroup, lesson.subject].filter(Boolean).join(" · ") || "Lesson",
    objectives: objectives.slice(0, 4).map((o) => o.text),
    factRefs: objectives.map((o) => o.id),
  };
}

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
  // Designer r4 (off by default): the objectives ride on the title slide when that title fits
  // every theme; the deck then has three fixed slides and one more cycle slot.
  const r6 = designerR6(deps);
  const agenda = r6 || objectivesOnTitle(deps) ? agendaTitleSpec(base, objectives) : undefined;
  const onTitle = agenda !== undefined && fitsPlanned(agenda, { stepDown: 1 }).ok;
  if (agenda && !onTitle) {
    deps.logger.info(
      { stage: "generate", call: "allocate", objectivesOnTitle: false },
      "objectives keep their own slide: the title with the objectives does not fit every theme",
    );
  }
  const r6Allocation = r6
    ? allocateR6(slideCount, arcs, { objectivesOnTitle: onTitle, bookends: base.facts?.bookends })
    : undefined;
  const allocation = r6Allocation ?? allocate(slideCount, arcs, { objectivesOnTitle: onTitle });
  const audience = audienceOf(base);
  const shape = shapeOf(base);
  const cls = planClassFor(base, deps);
  const palette = paletteMenu(subject);
  const findings: Finding[] = [...generationOf(base).findings];
  const at = () => deps.now().toISOString();
  const timings: DesignTimings = {
    designStartMs: Date.now() - startedAt,
    cycles: [],
    fitMs: 0,
  };
  const codeMeta = (): MaterialiseMeta => ({
    promptVersion: DESIGNER_VERSION,
    model: CODE_MODEL,
    at: at(),
  });
  // The facts feed (`DESIGNER_FACTS=1`): per objective the teach call, then Verify over its facts,
  // started now; each cycle waits only for its own facts.
  const feed = designerFactsOn()
    ? startFactsFeed({
        deps,
        cls,
        topic: brief.topic,
        shape,
        audience,
        objectives,
        durationMin: base.facts?.durationMin ?? brief.durationMin,
        priorKnowledge: brief.classContext?.priorKnowledge,
        sources: base.sources,
        retrieval: base.facts?.retrieval,
        startedAt,
        verifyEffort: VERIFY_EFFORT,
      })
    : undefined;
  /** Each objective's facts as the cycle and its re-fills are handed them (Verify's, once in). */
  const factsFor: (FedFacts | undefined)[] = objectives.map(() => undefined);
  deps.logger.info(
    {
      stage: "generate",
      call: "allocate",
      slideCount,
      cycles: allocation.cycles.map((c) => c.count),
      short: allocation.short,
      ...(onTitle ? { objectivesOnTitle: true } : {}),
      ...(r6Allocation
        ? { r6: true, bookends: r6Allocation.bookends, dropped: r6Allocation.dropped }
        : {}),
    },
    "designer allocation",
  );

  // The deck restarts from the title and objectives: a design step that stopped part-way is redone.
  const [title, objectivesSlide] = base.slides;
  if (!title || !objectivesSlide) throw new Error("design: the objectives step has not run");
  // With the objectives on the title, the title is redrawn with them (keeping its id) and the
  // objectives slide is dropped; the starter moves up to slide 2.
  const opening: Slide[] =
    onTitle && agenda
      ? [{ ...materialiseSlide(agenda, themeId, codeMeta(), deps.ids), id: title.id }]
      : [title, objectivesSlide];
  // The opening and closing slots: in r5 always a retrieval starter after the fixed slides and an
  // exit ticket last; in r6 only those the objectives call asked for and the deck kept.
  const openingAt = r6Allocation
    ? r6Allocation.openingSlide !== undefined && r6Allocation.bookends.opening
      ? { index: r6Allocation.openingSlide - 1, ...r6Allocation.bookends.opening }
      : undefined
    : { index: opening.length, kind: "retrieval" as const };
  const closingAt = r6Allocation
    ? r6Allocation.closingSlide !== undefined && r6Allocation.bookends.closing
      ? { index: r6Allocation.closingSlide - 1, ...r6Allocation.bookends.closing }
      : undefined
    : { index: slideCount - 1, kind: "check" as const };
  const starterIndex = openingAt?.index ?? opening.length;
  let lesson: Lesson = { ...base, slides: opening, fitVersion: FIT_VERSION };
  // r6: a retrieval opening's answers must lean on the prior knowledge the brief states (no earlier
  // slide teaches them). An unsupported question is re-filled in code: the starter keeps only the
  // supported ones, or falls back to the prior-knowledge prompt when none is. Logged.
  const openingSupport: NonNullable<DesignReport["answerSupport"]> = [];
  const prior = brief.classContext?.priorKnowledge;
  const asked0 = base.facts?.retrieval ?? [];
  let retrieval = asked0;
  if (r6 && openingAt?.kind === "retrieval") {
    const refilled = refillOpening(asked0, starterIndex + 1, prior);
    for (const sup of refilled.support) {
      openingSupport.push({
        slide: sup.slide,
        where: sup.where,
        ok: sup.ok,
        by: sup.by,
        ...(sup.ok ? {} : { missing: sup.missing }),
      });
    }
    if (refilled.kept.length < asked0.length) {
      retrieval = refilled.kept;
      deps.logger.info(
        {
          stage: "generate",
          call: "answer-refill",
          slide: starterIndex + 1,
          kept: retrieval.length,
          dropped: asked0.length - retrieval.length,
          support: openingSupport,
        },
        "starter re-filled with the questions the stated prior knowledge supports",
      );
    }
  }
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
  outline[0] = { id: "s1", kind: "title", factRefs: onTitle ? objectives.map((o) => o.id) : [] };
  if (!onTitle) {
    outline[1] = {
      id: "s2",
      kind: "objectives",
      factRefs: objectives.map((o) => o.id),
      phase: "starter",
    };
  }

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
      const firstInThisSave = firstSlotMs !== undefined && timings.firstSlotSavedMs === undefined;
      const { updatedAt } = await deps.persist(withUsage(lesson, deps));
      if (firstInThisSave) timings.firstSlotSavedMs = Date.now() - startedAt;
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

  const unfitSets: { slide: number; reason: string }[] = [];
  /** An r6 hook, plenary or debate: a discussion slot in code, fitted like any slot, never the notes. */
  const placeTalk = async (index: number, prompt: string, phase: "starter" | "check") => {
    const fit = await fitSlot(
      { form: "discussion", prompt },
      { seed: `${base.id}:${index}`, themeId, teachingToNotes: false },
    );
    if (fit.rung === "flagged") unfitSets.push({ slide: index + 1, reason: fit.reason ?? "" });
    outline[index] = { id: `s${index + 1}`, kind: kindOf(fit.render.spec), factRefs: [], phase };
    ready.set(index, renderSlot(fit.render, themeId, codeMeta(), deps.ids));
    void flush();
  };

  // The opening. A retrieval starter, in code: the objectives call's retrieval questions, answers
  // revealed (r5 always; r6 when asked for). An r6 hook is a discussion slot.
  if (openingAt && openingAt.kind !== "retrieval") {
    await placeTalk(
      starterIndex,
      bookendPrompt(openingAt.kind, brief.topic, openingAt.prompt),
      "starter",
    );
  } else if (openingAt) {
    const starterEntry: OutlineEntry = {
      id: `s${starterIndex + 1}`,
      kind: "starter",
      factRefs: [],
      phase: "starter",
    };
    outline[starterIndex] = starterEntry;
    const starterCoded = codedSetSpec(starterEntry, facts0, `${base.id}:2`);
    const starterSpec: SlideSpec = starterCoded?.spec ?? {
      kind: "starter",
      factRefs: [],
      heading: "Do now",
      items: [`What do you already know about ${brief.topic}?`],
    };
    const starterFitted = answersToNotesUnlessFit(starterSpec, starterCoded?.answers ?? []);
    if (!setFits(starterFitted))
      unfitSets.push({ slide: starterIndex + 1, reason: setFitReason(starterFitted) });
    if (starterFitted !== starterSpec) {
      deps.logger.info(
        { stage: "generate", slide: starterIndex + 1, rung: "notes" },
        "starter answers moved to the notes",
      );
    }
    ready.set(
      starterIndex,
      withAnswersReveal(materialiseSlide(starterFitted, themeId, codeMeta(), deps.ids), themeId),
    );
    void flush();
  }

  // An r6 plenary or debate closes the deck as a discussion slot; a closing check is the exit
  // ticket, written after the cycles below.
  if (closingAt && closingAt.kind !== "check") {
    await placeTalk(
      closingAt.index,
      bookendPrompt(closingAt.kind, brief.topic, closingAt.prompt),
      "check",
    );
  }

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

  // The cycles, in parallel and streamed; the first cycle's first slot is the first teaching slide.
  const firstCycle = allocation.cycles.find((c) => c.count > 0);
  let releaseFirst: () => void = () => {};
  const firstLanded = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const bound: Bound[] = [];
  const exitQuestions: (DesignCycleOutput["exitQuestion"] | undefined)[] = objectives.map(
    () => undefined,
  );
  const failedCycles: number[] = [];
  const retriedCycles: number[] = [];
  // Each cycle's first call, settled or failed: a retry waits for these, so the reservations of
  // the calls in flight beside it are released (settled on their real usage) before it asks again.
  const firstCalls = allocation.cycles.map(() => {
    let done: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      done = resolve;
    });
    return { promise, done };
  });
  /** A re-fill's role: the slot's own when it admits the form written, else the first that does. */
  const roleOf = (form: SlotForm, cycle: CycleSlots, k: number): SlotRole => {
    const own = cycle.roles[k];
    if (own && ROLE_FORMS[own].includes(form)) return own;
    return SLOT_ROLES.find((r) => ROLE_FORMS[r].includes(form)) ?? own ?? "teach";
  };
  const refillFor =
    (cycle: CycleSlots, k: number) => async (slot: DesignSlot, form: SlotForm, reason: string) => {
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
          slots: { count: 1, first: cycle.first + k, slideCount, roles: [roleOf(form, cycle, k)] },
          palette,
          replacing: { form: slot.form, material: slotMaterial(slot), reason, into: form },
          ...(factsFor[cycle.objective] ? { facts: factsFor[cycle.objective]?.cycle } : {}),
        },
        // The exit question is the cycle's, not the slot's: a re-fill's is never read, so a blank
        // one is not a reason to retry (r6 smoke: 5 re-fills failed validation with two
        // too_small or invalid_type issues, the exit question's two fields, each retried at a full
        // call's latency). Same keys, so the prompt's contract is unchanged.
        schema: zod.object({ slots: only.array().length(1), exitQuestion: REFILL_EXIT_QUESTION }),
        maxOutputTokens: MAX_OUTPUT_TOKENS_REFILL,
      });
      deps.logger.info(
        { stage: "generate", call: "refill", from: slot.form, to: form, reason },
        "designer refill",
      );
      return (call.output as unknown as { slots: DesignSlot[] }).slots[0];
    };

  const landSlot = async (cycle: CycleSlots, k: number, slot: DesignSlot, modelId: string) => {
    const index = cycle.first - 1 + k;
    if (cycleSlides.has(index)) return;
    cycleSlides.add(index);
    const timing = timings.cycles.find((c) => c.objective === cycle.objective);
    if (timing && timing.firstSlotAfterMs === undefined)
      timing.firstSlotAfterMs = Date.now() - startedAt - timing.startMs;
    const fitStart = Date.now();
    const fit = await fitSlot(slot, {
      seed: `${base.id}:${index}`,
      themeId,
      teachingToNotes: !r6,
      refill: (s, form, reason) =>
        refillFor(cycle, k)(s, form, `it did not fit its slide because ${reason}`),
    });
    timings.fitMs += Date.now() - fitStart;
    // The first teaching slide goes first: another cycle's slot is placed once it has landed (or
    // its cycle has ended), so its save is never queued behind later slides. Only the placing
    // waits: every slot's fit, and any re-fill it needs, runs as soon as the slot is written
    // (r6 smoke: the second cycle's re-fills sat behind the first slot's for 6 s).
    if (cycle !== firstCycle) await firstLanded;
    placeSlot(cycle, k, slot, fit, modelId);
    if (cycle === firstCycle && k === 0) releaseFirst();
  };

  /**
   * A fitted slot onto the deck: rendered, its outline entry written, queued in slide order (or,
   * for a slot re-filled after its slide was saved, put in place under the same id and saved),
   * and its photo searched.
   */
  const placeSlot = (
    cycle: CycleSlots,
    k: number,
    slot: DesignSlot,
    fit: SlotFit,
    modelId: string,
  ) => {
    const index = cycle.first - 1 + k;
    const at0 = bound.findIndex((x) => x.slide === index);
    const b: Bound = { slide: index, objective: cycle.objective, slot, fit };
    if (at0 >= 0) bound[at0] = b;
    else bound.push(b);
    const slide = renderSlot(
      fit.render,
      themeId,
      { promptVersion: designCyclePrompt.version, model: modelId, at: at() },
      deps.ids,
    );
    const imageBrief = imageBriefOf(fit.slot);
    const misconceptionId = facts0.misconceptions.find((m) =>
      m.objectiveRefs.includes(objectives[cycle.objective]?.id ?? "o1"),
    )?.id;
    outline[index] = {
      id: `s${index + 1}`,
      // A photo slot is laid out as a content slide with a photo zone (palette "photo"), but its
      // outline entry is an image-text entry: the facts schema allows an imageBrief only there.
      kind: imageBrief ? "image-text" : kindOf(fit.render.spec),
      factRefs: [objectives[cycle.objective]?.id ?? "o1"],
      brief: {
        adds: "heading" in fit.slot ? fit.slot.heading : "stem" in fit.slot ? fit.slot.stem : "",
      },
      phase: CHECK_FORMS.has(fit.slot.form) ? "check" : "explain",
      ...(imageBrief ? { imageBrief } : {}),
      // A watch-out callout cites the objective's misconception (the facts schema's rule).
      ...(fit.render.spec.kind === "content" && fit.render.spec.callout && misconceptionId
        ? { callout: { kind: fit.render.spec.callout.kind, factRefs: [misconceptionId] } }
        : {}),
      // Only a drawn figure is a diagram entry; the labelled placeholder is a content entry.
      ...(fit.slot.form === "figure" && fit.render.spec.kind === "diagram"
        ? {
            figureBrief: {
              template: fit.slot.figureBrief.template,
              purpose: fit.slot.figureBrief.purpose.slice(0, 160),
            },
          }
        : {}),
    };
    if (at0 < 0) {
      ready.set(index, slide);
      void flush();
    } else {
      writing = writing.then(async () => {
        const old = lesson.slides[index];
        if (!old) {
          ready.set(index, slide);
          return;
        }
        lesson = {
          ...lesson,
          slides: lesson.slides.map((x, i) => (i === index ? { ...slide, id: old.id } : x)),
        };
        if (!deps.signal.aborted) await deps.persist(withUsage(lesson, deps));
      });
    }
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

  const refillModelId = () => {
    const routed = deps.ai.model(
      cls,
      callContext(deps, "generate", designCyclePrompt.version, "low"),
    );
    return typeof routed === "string" ? routed : routed.modelId;
  };

  const runCycle = async (cycle: CycleSlots) => {
    const slot = allocation.cycles.indexOf(cycle);
    if (cycle.count === 0) {
      firstCalls[slot]?.done();
      return;
    }
    // The facts feed: this cycle starts the moment its own objective's facts are in.
    const objectiveFeed = feed?.[cycle.objective];
    if (objectiveFeed) factsFor[cycle.objective] = await objectiveFeed.facts;
    const timing: DesignTimings["cycles"][number] = {
      objective: cycle.objective,
      startMs: Date.now() - startedAt,
    };
    timings.cycles.push(timing);
    const schema = designCycleSchemaFor(subject, cycle.count);
    const slotSchema = schema.shape.slots.element;
    const landing: Promise<void>[] = [];
    let modelId = "unknown";
    const land = (k: number, raw: unknown) => {
      const parsed = slotSchema.safeParse(raw);
      if (parsed.success) landing.push(landSlot(cycle, k, parsed.data as DesignSlot, modelId));
    };
    const design = async (attempt: 1 | 2): Promise<boolean> => {
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
          {
            stage: "generate",
            call: "design-cycle",
            objective: cycle.objective,
            slots: cycle.count,
            attempt,
          },
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
            slots: { count: cycle.count, first: cycle.first, slideCount, roles: cycle.roles },
            palette,
            ...(factsFor[cycle.objective] ? { facts: factsFor[cycle.objective]?.cycle } : {}),
          },
          schema,
          maxOutputTokens: designCycleMaxOutputTokens(cycle.count),
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
        timing.doneAfterMs = Date.now() - startedAt - timing.startMs;
        const output = call.output as DesignCycleOutput;
        output.slots.forEach((slot, k) => {
          if (!cycleSlides.has(cycle.first - 1 + k))
            landing.push(landSlot(cycle, k, slot, modelId));
        });
        exitQuestions[cycle.objective] = output.exitQuestion;
        return true;
      } catch (error) {
        if (!(error instanceof BudgetExceeded) && !(error instanceof StageFailure)) {
          if (error instanceof Error && error.name === "AbortError") throw error;
        }
        // Never a silent fallback: a failed cycle is an error, retried once; only a second failure
        // leaves its slots as open questions on the objective.
        deps.logger.error(
          {
            stage: "generate",
            call: "design-cycle",
            objective: cycle.objective,
            attempt,
            refused: error instanceof BudgetExceeded,
            err: safeError(error),
          },
          attempt === 1
            ? "design cycle failed; retrying once"
            : "design cycle failed twice; its slots are open questions on the objective",
        );
        return false;
      }
    };
    let designed: boolean;
    try {
      designed = await design(1);
    } finally {
      firstCalls[slot]?.done();
    }
    if (!designed) {
      retriedCycles.push(cycle.objective);
      await Promise.all(firstCalls.map((c) => c.promise));
      designed = await design(2);
    }
    if (!designed) failedCycles.push(cycle.objective);
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
    if (objectiveFeed) await refillCorrected(cycle, objectiveFeed);
  };

  /**
   * The facts feed's Verify, awaited once the cycle has landed: when it corrected the facts, the
   * cycle's slots whose words carry what a correction took out are re-filled in their own form from
   * the corrected facts, and placed when the new slot fits; every other slot stands.
   */
  const refillCorrected = async (
    cycle: CycleSlots,
    objectiveFeed: NonNullable<typeof feed>[number],
  ) => {
    const verified = await objectiveFeed.verified;
    if (!verified || verified.corrections.length === 0) return;
    factsFor[cycle.objective] = verified.facts;
    const mine = bound.filter((b) => b.objective === cycle.objective);
    const hit = correctedSlots(
      verified.corrections,
      mine.map((b) => ({ key: b.slide, material: slotMaterial(b.fit.slot) })),
      factsWords(verified.facts.cycle),
    );
    const said = verified.corrections
      .map((c) => (c.before ? `"${c.before}" is corrected to "${c.after}"` : `"${c.after}"`))
      .join("; ");
    await Promise.all(
      hit.map(async (slide) => {
        const b = bound.find((x) => x.slide === slide);
        if (!b) return;
        const k = b.slide - (cycle.first - 1);
        const form = b.fit.slot.form;
        const fresh = await refillFor(cycle, k)(
          b.fit.slot,
          form,
          `a fact it used was wrong (${said})`,
        ).catch(() => undefined);
        const fit = fresh
          ? await fitSlot(fresh, { seed: `${base.id}:${b.slide}`, themeId, teachingToNotes: !r6 })
          : undefined;
        const ok = !!fresh && !!fit && fit.rung !== "flagged";
        deps.logger.info(
          { stage: "generate", call: "facts-refill", slide: slide + 1, form, ok },
          "facts feed: slot re-filled after a Verify correction",
        );
        if (ok && fresh && fit) {
          placeSlot(cycle, k, fresh, fit, refillModelId());
          objectiveFeed.timing.refilled.push(slide + 1);
        }
      }),
    );
  };

  await Promise.all(
    allocation.cycles.map((cycle) =>
      cycle === firstCycle ? runCycle(cycle).finally(releaseFirst) : runCycle(cycle),
    ),
  );
  throwIfAborted(deps.signal);
  if (feed) timings.factsFeed = feed.map((f) => f.timing);

  // The design minimums, enforced (designer eval r1): an objective that needs a visual and has
  // none, or a lesson under 3 checks, gets at most 2 single-slot re-fills into the missing form.
  // A re-fill that does not come back in that form, or does not fit at full size, leaves the slot.
  const offered = slotFormsFor(subject);
  const toEnforce = minimumRefills(
    bound.map((b) => {
      const cycle = allocation.cycles.find((c) => c.objective === b.objective);
      const role = cycle?.roles[b.slide - (cycle.first - 1)];
      return {
        objective: b.objective,
        form: b.fit.slot.form,
        slide: b.slide + 1,
        ...(role ? { role } : {}),
      };
    }),
    arcs,
    offered,
  );
  const enforced: { slide: number; into: SlotForm; ok: boolean; skipped?: true }[] = [];
  await Promise.all(
    toEnforce.map(async (m) => {
      const b = bound.find((x) => x.slide === m.slide - 1);
      const cycle = allocation.cycles.find((c) => c.objective === m.objective);
      if (!b || !cycle) return;
      // A slot already written in that form that did not fit (as designed, or re-filled on the
      // ladder) is not asked again: on the r6 smoke both minimum re-fills were such repeats,
      // failed again, and held the editable deck back a whole call (about 9 s).
      if (b.slot.form === m.into || b.fit.tried.some((t) => t.form === m.into && !t.ok)) {
        enforced.push({ slide: m.slide, into: m.into, ok: false, skipped: true });
        return;
      }
      const k = b.slide - (cycle.first - 1);
      const fresh = await refillFor(cycle, k)(b.fit.slot, m.into, m.reason).catch(() => undefined);
      const fit = fresh
        ? await fitSlot(fresh, { seed: `${base.id}:${b.slide}`, themeId, teachingToNotes: !r6 })
        : undefined;
      const meets = (form: SlotForm) =>
        m.role
          ? ROLE_FORMS[m.role].includes(form)
          : m.into === "true-false"
            ? CHECK_FORMS.has(form)
            : VISUAL_FORMS.has(form);
      const ok =
        !!fresh &&
        !!fit &&
        fit.rung !== "flagged" &&
        fit.rung !== "step-down" &&
        meets(fit.slot.form);
      enforced.push({ slide: m.slide, into: m.into, ok });
      if (ok && fresh && fit) placeSlot(cycle, k, fresh, fit, refillModelId());
    }),
  );
  if (toEnforce.length > 0) {
    deps.logger.info({ stage: "generate", enforced }, "designer minimums enforced");
  }
  await writing;

  // r6: every check's answer is taught on an earlier slide (`answerSupport`). A check that is not
  // gets one re-fill of its question in its own form, told what the earlier slides teach; the new
  // slot lands only when it fits and its answer is then supported. Nothing moves to the notes.
  const supportLog: NonNullable<DesignReport["answerSupport"]> = [...openingSupport];
  if (r6) {
    const taughtNow = () =>
      bound
        .map((b) => ({
          slide: b.slide + 1,
          text: taughtText(b.fit.slot),
          refs: refsOfSlot(b.fit.slot),
        }))
        .filter((t) => t.text !== "");
    const askedOfBound = (b: Bound): Asked | undefined => {
      const q = askedOf(b.fit.slot);
      return q
        ? { slide: b.slide + 1, where: "check", ...q, refs: refsOfSlot(b.fit.slot) }
        : undefined;
    };
    const first = answerSupport(
      bound.flatMap((b) => askedOfBound(b) ?? []),
      taughtNow(),
    );
    await Promise.all(
      first.map(async (sup) => {
        if (sup.ok) {
          supportLog.push({ slide: sup.slide, where: sup.where, ok: true, by: sup.by });
          return;
        }
        const b = bound.find((x) => x.slide === sup.slide - 1);
        const cycle = b && allocation.cycles.find((c) => c.objective === b.objective);
        if (!b || !cycle) return;
        const k = b.slide - (cycle.first - 1);
        const earlier = taughtNow()
          .map((t) => t.slide)
          .filter((n) => n < sup.slide);
        const reason = unsupportedReason(sup, earlier);
        const fresh = await refillFor(cycle, k)(b.fit.slot, b.fit.slot.form, reason).catch(
          () => undefined,
        );
        const fit = fresh
          ? await fitSlot(fresh, { seed: `${base.id}:${b.slide}`, themeId, teachingToNotes: false })
          : undefined;
        const again =
          fit && fit.rung !== "flagged"
            ? answerSupport([askedOfBound({ ...b, fit }) as Asked].filter(Boolean), taughtNow())[0]
            : undefined;
        const ok = !!fresh && !!fit && !!again?.ok;
        if (ok && fresh && fit) placeSlot(cycle, k, fresh, fit, refillModelId());
        supportLog.push({
          slide: sup.slide,
          where: sup.where,
          ok: false,
          by: sup.by,
          missing: sup.missing,
          refilled: ok,
        });
        deps.logger.info(
          { stage: "generate", call: "answer-refill", slide: sup.slide, missing: sup.missing, ok },
          "answer not on an earlier slide: question re-filled",
        );
      }),
    );
    await writing;
  }

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
  // r6: only when the objectives call asked for a closing check; an exit question whose answer
  // no earlier slide carries is re-filled in code with the objective's first check (logged).
  const exitTicket = !r6Allocation || closingAt?.kind === "check";
  const closingTaught = r6
    ? bound
        .map((b) => ({
          slide: b.slide + 1,
          text: taughtText(b.fit.slot),
          refs: refsOfSlot(b.fit.slot),
        }))
        .filter((t) => t.text !== "")
    : [];
  const exitRefs: string[] = [];
  objectives.forEach((o, i) => {
    if (!exitTicket) return;
    let eq = exitQuestions[i];
    if (eq && r6) {
      const [sup] = answerSupport(
        [{ slide: slideCount, where: "closing", question: eq.question, answer: eq.answer }],
        closingTaught,
      );
      if (sup) {
        supportLog.push({
          slide: sup.slide,
          where: sup.where,
          ok: sup.ok,
          by: sup.by,
          ...(sup.ok ? {} : { missing: sup.missing, refilled: true }),
        });
        if (!sup.ok) {
          deps.logger.info(
            { stage: "generate", call: "answer-refill", slide: sup.slide, missing: sup.missing },
            "exit answer not on an earlier slide: the objective's first check stands in",
          );
          eq = undefined;
        }
      }
    }
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
  if (exitTicket) outline[exitIndex] = exitEntry;
  facts.outline = outline;
  const exitCoded = exitTicket
    ? codedSetSpec(exitEntry, facts, `${base.id}:${exitIndex}`)
    : undefined;
  // One line per objective: when the reveal strip crowds a line off, every line is printed and the
  // answers move to the notes, word for word (rung 3 on the ticket), if that fits.
  const exitAll = exitTicketAll(exitRefs, facts);
  let exitSpec: SlideSpec = exitCoded?.spec ?? exitAll.spec;
  let exitPrinted = exitCoded?.questionRefs ?? [];
  const exitShort =
    exitTicket && (exitPrinted.length < exitRefs.length || (exitCoded && !setFits(exitCoded.spec)));
  if (exitShort && setFits(exitAll.spec)) {
    exitSpec = exitAll.spec;
    exitPrinted = exitRefs;
    deps.logger.info(
      { stage: "generate", slide: slideCount, rung: "notes" },
      "exit answers moved to the notes",
    );
  }
  if (exitTicket && !setFits(exitSpec))
    unfitSets.push({ slide: slideCount, reason: setFitReason(exitSpec) });
  const exitCovered = new Set(
    exitPrinted.flatMap((id) => facts.questions.find((q) => q.id === id)?.objectiveRefs ?? []),
  ).size;
  if (exitTicket && exitCovered < objectives.length) {
    deps.logger.warn(
      { stage: "generate", covered: exitCovered, objectives: objectives.length },
      "exit ticket misses an objective",
    );
  }
  if (exitTicket) {
    ready.set(
      exitIndex,
      withAnswersReveal(materialiseSlide(exitSpec, themeId, codeMeta(), deps.ids), themeId),
    );
  }
  lesson = { ...lesson, facts };
  await flush();
  await writing;
  if (lesson.slides.length !== slideCount) {
    throw new StageFailure(
      "generate",
      `design: ${lesson.slides.length} of ${slideCount} slides were written`,
    );
  }

  // The fit flags, then the deck saved as generated: editable now, before Verify and the photo
  // searches finish (the plan's step 6: neither blocks the save). What they change is saved after.
  const rungs: Record<string, number> = {};
  for (const b of bound) rungs[b.fit.rung] = (rungs[b.fit.rung] ?? 0) + 1;
  // Every saved slide passes the save gate or carries a flag that says why.
  const flag = (index: number, reason: string) =>
    findings.push({
      check: "fit",
      severity: "warning",
      target: { slideId: lesson.slides[index]?.id },
      message: `This slide does not fit the save gate: it ${reason}.`,
    });
  for (const b of bound) {
    if (b.fit.rung === "flagged") flag(b.slide, b.fit.reason ?? "fails on some themes");
  }
  for (const u of unfitSets) flag(u.slide - 1, u.reason);
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
            planned: joinVersions(DESIGNER_VERSION, verifyFactsPrompt.version),
            generated: designCyclePrompt.version,
          },
          findings: [...findings],
        },
      },
      deps,
    );
  };
  lesson = asGenerated(lesson, facts);
  let editableMs = 0;
  writing = writing.then(async () => {
    const { updatedAt } = await deps.persist(lesson);
    editableMs = Date.now() - startedAt;
    await deps.onProgress(PROGRESS_GENERATED, "Slides ready", "generate", updatedAt);
  });
  await writing;
  timings.editableMs = editableMs;

  // Verify, after the save, alongside the photo searches, at `VERIFY_EFFORT`: a correction replaces
  // a slide only when the corrected slot still fits in its own form.
  const verifyReport = { corrections: 0, refitted: 0, rejected: 0 };
  const verifyStart = Date.now();
  const [verified] = await Promise.all([
    runVerify(facts, { topic: brief.topic, audience }, deps, cls, VERIFY_EFFORT).finally(() => {
      timings.verifyMs = Date.now() - verifyStart;
    }),
    Promise.all(photos),
  ]);
  await writing;
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
      // Re-checked with `fitsPlanned` (via `fitSlot`'s first two rungs): the corrected words land
      // only in the slot's own form at full size on every theme; any lower rung keeps the slide.
      const refit = await fitSlot(corrected, {
        seed: `${base.id}:${b.slide}`,
        themeId,
        teachingToNotes: !r6,
      });
      if (refit.rung !== "fits" && refit.rung !== "variant") {
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
    if (exitTicket && reprinted) {
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
  // What Verify and the photos changed, saved over the generated deck (same checkpoint).
  lesson = asGenerated(lesson, finalFacts);
  if (!deps.signal.aborted) await deps.persist(lesson);

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
        ...(b.fit.reason ? { reason: b.fit.reason } : {}),
        designed: b.slot,
        landed: b.fit.slot,
      })),
    ...(unfitSets.length > 0 ? { unfitSets } : {}),
    rungs,
    minimums,
    exitCovered,
    failedCycles,
    retriedCycles,
    verify: verifyReport,
    ...(enforced.length > 0 ? { enforced } : {}),
    ...(firstSlotMs !== undefined ? { firstSlotMs } : {}),
    editableMs,
    timings,
    photos: photoCounts,
    ...(r6 ? { answerSupport: supportLog } : {}),
  };
  if (feed) {
    deps.logger.info(
      { stage: "generate", factsFeed: timings.factsFeed },
      "designer facts feed latency",
    );
  }
  deps.logger.info({ stage: "generate", designer: report }, "designer report");
  const { pendingVerify: _none, ...rest } = state;
  return { ...rest, lesson, designReport: report };
}
