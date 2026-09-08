import {
  GENERATABLE_BLOCK_TYPES,
  type GeneratableBlockType,
  type GeneratableSlideKind,
  type LessonFacts,
  type Objective,
  type OutlineEntry,
  type VocabularyItem,
} from "@tj/domain/documents";

/*
 * Plan review state (prototype, `proto/plan-review`): the pure reducer behind the five review
 * screens. It starts from the `LessonFacts` Plan persisted, keeps the teacher's edits beside a
 * "touched" set so every field reads "suggested" until touched and "yours" after, and derives the
 * `LessonFacts` to generate from (`factsOf`) with every reference still valid. No React here.
 *
 * Prototype-only: the pipeline emits neither a one-line summary per outline entry nor a
 * worksheet outline today (Linear project "Plan review", "Generation contract"); both are derived
 * deterministically from the facts here so the screens have something honest to show.
 */

export const PLAN_STEPS = [
  { id: "objectives", label: "Objectives" },
  { id: "shape", label: "Shape of the lesson" },
  { id: "words", label: "Words they will need" },
  { id: "worksheet", label: "Worksheet" },
  { id: "summary", label: "Summary" },
] as const;
export type PlanStepId = (typeof PLAN_STEPS)[number]["id"];
const STEP_IDS = PLAN_STEPS.map((step) => step.id);

export const OBJECTIVES_MAX = 4;
export const VOCABULARY_MAX = 6;
export const PHASES_MAX = 16;
export const BLOCKS_MAX = 12;

export const TIERS = ["support", "core", "challenge"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABELS: Record<Tier, string> = {
  support: "Support",
  core: "Core",
  challenge: "Challenge",
};

export type WorksheetBlockOutline = { type: GeneratableBlockType; summary: string };
export type WorksheetOutline = {
  enabled: boolean;
  blocks: WorksheetBlockOutline[];
  tiers: Tier[];
};

/** An outline entry with the one-line summary the review shows. */
export type Phase = OutlineEntry & { summary: string };

export type PlanReviewState = {
  step: PlanStepId;
  /** Steps the teacher has confirmed (Continue, or accept-all). */
  done: PlanStepId[];
  /** What Plan proposed; the arrays the review does not edit are taken from here. */
  base: LessonFacts;
  objectives: Objective[];
  phases: Phase[];
  vocabulary: VocabularyItem[];
  worksheet: WorksheetOutline;
  /** Field keys the teacher has touched: `objective:o1`, `phase:s3`, `phases:order`, … */
  touched: Record<string, true>;
};

export type PlanReviewAction =
  | { type: "go"; step: PlanStepId }
  | { type: "next" }
  | { type: "back" }
  | { type: "acceptAll" }
  | { type: "editObjective"; id: string; text: string }
  | { type: "addObjective" }
  | { type: "removeObjective"; id: string }
  | { type: "moveObjective"; id: string; delta: -1 | 1 }
  | { type: "editPhase"; id: string; summary?: string; minutes?: number }
  | { type: "movePhase"; from: number; to: number }
  | { type: "movePhaseBy"; id: string; delta: -1 | 1 }
  | { type: "addPhase"; kind: GeneratableSlideKind }
  | { type: "removePhase"; id: string }
  | { type: "editVocabulary"; id: string; term?: string; definition?: string }
  | { type: "addVocabulary" }
  | { type: "removeVocabulary"; id: string }
  | { type: "setWorksheetEnabled"; enabled: boolean }
  | { type: "editBlock"; index: number; type_?: GeneratableBlockType; summary?: string }
  | { type: "addBlock"; blockType: GeneratableBlockType }
  | { type: "removeBlock"; index: number }
  | { type: "toggleTier"; tier: Tier };

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

export const SLIDE_KIND_LABELS: Record<GeneratableSlideKind, string> = {
  title: "Title",
  objectives: "Objectives",
  starter: "Starter",
  vocabulary: "Vocabulary",
  content: "Explain",
  "worked-example": "Worked example",
  instructions: "Instructions",
  discussion: "Discussion",
  "true-false": "True or false",
  "multiple-choice": "Multiple choice",
  matching: "Matching",
  "fill-gap": "Fill the gap",
  sort: "Sort",
  "open-response": "Open response",
  "exit-ticket": "Exit ticket",
  plenary: "Plenary",
};

export const BLOCK_TYPE_LABELS: Record<GeneratableBlockType, string> = {
  heading: "Heading",
  instructions: "Instructions",
  paragraph: "Paragraph",
  question: "Question",
  "multiple-choice": "Multiple choice",
  "fill-gap": "Fill the gap",
  matching: "Matching",
  "word-bank": "Word bank",
};

/* ------------------------------------------------------------------ */
/* Derivations (prototype-only: Plan does not emit these yet)          */
/* ------------------------------------------------------------------ */

const clip = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The one line the Shape step shows under a kind, from the facts the entry references. */
export function phaseSummary(entry: OutlineEntry, facts: LessonFacts): string {
  const refs = new Set(entry.factRefs);
  const question = facts.questions.find((q) => refs.has(q.id));
  const example = facts.workedExamples.find((x) => refs.has(x.id));
  const terms = facts.vocabulary.filter((v) => refs.has(v.id)).map((v) => v.term);
  const objective = facts.objectives.find((o) => refs.has(o.id));
  switch (entry.kind) {
    case "title":
      return "The lesson title and the year group.";
    case "objectives":
      return `The ${facts.objectives.length} objectives, read together.`;
    case "vocabulary":
      return terms.length > 0 ? terms.join(", ") : "The key words with their definitions.";
    case "worked-example":
      return example ? clip(example.problem) : "One problem worked through step by step.";
    case "exit-ticket":
      return "Quick checks on each objective before they leave.";
    case "plenary":
      return "Look back over the objectives together.";
    case "content":
      return objective ? clip(objective.text) : "The main explanation.";
    case "instructions":
      return "What to do in the next activity.";
    case "discussion":
      return objective ? `Talk about: ${clip(objective.text, 56)}` : "A question to talk about.";
    default:
      return question
        ? clip(question.stem)
        : objective
          ? clip(objective.text)
          : "A check on what they have learned so far.";
  }
}

/** A worksheet outline the review can show; the pipeline generates a worksheet in one call today. */
export function worksheetOutlineOf(facts: LessonFacts): WorksheetOutline {
  const blocks: WorksheetBlockOutline[] = [
    { type: "heading", summary: "The lesson title" },
    { type: "instructions", summary: "Answer every question. Use the word bank for spellings." },
  ];
  if (facts.vocabulary.length > 0) {
    blocks.push({ type: "word-bank", summary: facts.vocabulary.map((v) => v.term).join(", ") });
  }
  for (const question of facts.questions.slice(0, 2)) {
    blocks.push({ type: "question", summary: clip(question.stem) });
  }
  if (facts.vocabulary.length > 1) {
    blocks.push({ type: "fill-gap", summary: "Definitions with the key word missing" });
  }
  const third = facts.questions[2];
  if (third) blocks.push({ type: "multiple-choice", summary: clip(third.stem) });
  return { enabled: true, blocks, tiers: [...TIERS] };
}

/* ------------------------------------------------------------------ */
/* Ids and helpers                                                     */
/* ------------------------------------------------------------------ */

function allIds(state: Pick<PlanReviewState, "base" | "objectives" | "vocabulary" | "phases">) {
  return [
    ...state.base.objectives,
    ...state.base.vocabulary,
    ...state.base.workedExamples,
    ...state.base.questions,
    ...state.base.misconceptions,
    ...state.base.outline,
    ...state.objectives,
    ...state.vocabulary,
    ...state.phases,
  ].map((item) => item.id);
}

/** The next free id for a prefix: one past the highest number ever used, so ids never repeat. */
function mintId(prefix: string, ids: string[]): string {
  let max = 0;
  for (const id of ids) {
    if (id.startsWith(prefix))
      max = Math.max(max, Number.parseInt(id.slice(prefix.length), 10) || 0);
  }
  return `${prefix}${max + 1}`;
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

const touch = (state: PlanReviewState, ...keys: string[]): PlanReviewState => {
  const touched = { ...state.touched };
  for (const key of keys) touched[key] = true;
  return { ...state, touched };
};

const stripRef = (phases: Phase[], id: string): Phase[] =>
  phases.map((phase) =>
    phase.factRefs.includes(id)
      ? { ...phase, factRefs: phase.factRefs.filter((ref) => ref !== id) }
      : phase,
  );

/* ------------------------------------------------------------------ */
/* Init, reducer, selectors                                            */
/* ------------------------------------------------------------------ */

export function initPlanReview(facts: LessonFacts): PlanReviewState {
  return {
    step: "objectives",
    done: [],
    base: facts,
    objectives: facts.objectives.map((o) => ({ ...o })),
    phases: facts.outline.map((entry) => ({ ...entry, summary: phaseSummary(entry, facts) })),
    vocabulary: facts.vocabulary.map((v) => ({ ...v })),
    worksheet: worksheetOutlineOf(facts),
    touched: {},
  };
}

export function planReviewReducer(
  state: PlanReviewState,
  action: PlanReviewAction,
): PlanReviewState {
  switch (action.type) {
    case "go": {
      const target = STEP_IDS.indexOf(action.step);
      const current = STEP_IDS.indexOf(state.step);
      // Forward only through Continue; back to any step already seen.
      if (target > current && !state.done.includes(action.step)) return state;
      return { ...state, step: action.step };
    }
    case "next": {
      const index = STEP_IDS.indexOf(state.step);
      const next = STEP_IDS[index + 1];
      const done = state.done.includes(state.step) ? state.done : [...state.done, state.step];
      return next ? { ...state, step: next, done } : { ...state, done };
    }
    case "back": {
      const index = STEP_IDS.indexOf(state.step);
      const previous = STEP_IDS[index - 1];
      return previous ? { ...state, step: previous } : state;
    }
    case "acceptAll":
      return { ...state, step: "summary", done: STEP_IDS.filter((id) => id !== "summary") };

    case "editObjective":
      return touch(
        {
          ...state,
          objectives: state.objectives.map((o) =>
            o.id === action.id ? { ...o, text: action.text } : o,
          ),
        },
        `objective:${action.id}`,
      );
    case "addObjective": {
      if (state.objectives.length >= OBJECTIVES_MAX) return state;
      const id = mintId("o", allIds(state));
      // The objectives slide reads every objective.
      const phases = state.phases.map((phase) =>
        phase.kind === "objectives" ? { ...phase, factRefs: [...phase.factRefs, id] } : phase,
      );
      return touch(
        { ...state, objectives: [...state.objectives, { id, text: "" }], phases },
        `objective:${id}`,
        "objectives:list",
      );
    }
    case "removeObjective":
      if (state.objectives.length <= 1) return state;
      return touch(
        {
          ...state,
          objectives: state.objectives.filter((o) => o.id !== action.id),
          phases: stripRef(state.phases, action.id),
        },
        "objectives:list",
      );
    case "moveObjective": {
      const from = state.objectives.findIndex((o) => o.id === action.id);
      const objectives = move(state.objectives, from, from + action.delta);
      return objectives === state.objectives
        ? state
        : touch({ ...state, objectives }, "objectives:order");
    }

    case "editPhase":
      return touch(
        {
          ...state,
          phases: state.phases.map((phase) =>
            phase.id === action.id
              ? {
                  ...phase,
                  summary: action.summary ?? phase.summary,
                  minutes: action.minutes ?? phase.minutes,
                }
              : phase,
          ),
        },
        `phase:${action.id}`,
      );
    case "movePhase": {
      const phases = move(state.phases, action.from, action.to);
      return phases === state.phases ? state : touch({ ...state, phases }, "phases:order");
    }
    case "movePhaseBy": {
      const from = state.phases.findIndex((phase) => phase.id === action.id);
      const phases = move(state.phases, from, from + action.delta);
      return phases === state.phases ? state : touch({ ...state, phases }, "phases:order");
    }
    case "addPhase": {
      if (state.phases.length >= PHASES_MAX) return state;
      const id = mintId("s", allIds(state));
      const entry: OutlineEntry = { id, kind: action.kind, minutes: 5, factRefs: [] };
      const phase: Phase = { ...entry, summary: phaseSummary(entry, factsOf(state)) };
      return touch({ ...state, phases: [...state.phases, phase] }, `phase:${id}`, "phases:list");
    }
    case "removePhase":
      if (state.phases.length <= 2) return state;
      return touch(
        { ...state, phases: state.phases.filter((phase) => phase.id !== action.id) },
        "phases:list",
      );

    case "editVocabulary":
      return touch(
        {
          ...state,
          vocabulary: state.vocabulary.map((v) =>
            v.id === action.id
              ? {
                  ...v,
                  term: action.term ?? v.term,
                  definition: action.definition ?? v.definition,
                }
              : v,
          ),
        },
        `vocabulary:${action.id}`,
      );
    case "addVocabulary": {
      if (state.vocabulary.length >= VOCABULARY_MAX) return state;
      const id = mintId("v", allIds(state));
      const phases = state.phases.map((phase) =>
        phase.kind === "vocabulary" ? { ...phase, factRefs: [...phase.factRefs, id] } : phase,
      );
      return touch(
        { ...state, vocabulary: [...state.vocabulary, { id, term: "", definition: "" }], phases },
        `vocabulary:${id}`,
        "vocabulary:list",
      );
    }
    case "removeVocabulary":
      return touch(
        {
          ...state,
          vocabulary: state.vocabulary.filter((v) => v.id !== action.id),
          phases: stripRef(state.phases, action.id),
        },
        "vocabulary:list",
      );

    case "setWorksheetEnabled":
      return touch(
        { ...state, worksheet: { ...state.worksheet, enabled: action.enabled } },
        "worksheet:enabled",
      );
    case "editBlock":
      return touch(
        {
          ...state,
          worksheet: {
            ...state.worksheet,
            blocks: state.worksheet.blocks.map((block, i) =>
              i === action.index
                ? { type: action.type_ ?? block.type, summary: action.summary ?? block.summary }
                : block,
            ),
          },
        },
        "worksheet:blocks",
      );
    case "addBlock":
      if (state.worksheet.blocks.length >= BLOCKS_MAX) return state;
      return touch(
        {
          ...state,
          worksheet: {
            ...state.worksheet,
            blocks: [...state.worksheet.blocks, { type: action.blockType, summary: "" }],
          },
        },
        "worksheet:blocks",
      );
    case "removeBlock":
      return touch(
        {
          ...state,
          worksheet: {
            ...state.worksheet,
            blocks: state.worksheet.blocks.filter((_, i) => i !== action.index),
          },
        },
        "worksheet:blocks",
      );
    case "toggleTier": {
      const has = state.worksheet.tiers.includes(action.tier);
      const tiers = has
        ? state.worksheet.tiers.filter((tier) => tier !== action.tier)
        : TIERS.filter((tier) => tier === action.tier || state.worksheet.tiers.includes(tier));
      return touch({ ...state, worksheet: { ...state.worksheet, tiers } }, "worksheet:tiers");
    }
  }
}

/** Whether the teacher has touched a field (or a list): "yours" rather than "suggested". */
export const isYours = (state: PlanReviewState, key: string): boolean =>
  state.touched[key] === true;

/** Every key touched so far; the Summary counts these. */
export const yoursKeys = (state: PlanReviewState): string[] => Object.keys(state.touched);

export const totalMinutes = (state: PlanReviewState): number =>
  state.phases.reduce((sum, phase) => sum + phase.minutes, 0);

/**
 * The `LessonFacts` to generate from: the edited objectives, vocabulary and outline over the
 * untouched arrays from Plan, with every `factRefs` entry still pointing at a fact that exists.
 */
export function factsOf(state: PlanReviewState): LessonFacts {
  const live = new Set([
    ...state.objectives.map((o) => o.id),
    ...state.vocabulary.map((v) => v.id),
    ...state.base.workedExamples.map((x) => x.id),
    ...state.base.questions.map((q) => q.id),
    ...state.base.misconceptions.map((m) => m.id),
  ]);
  return {
    ...state.base,
    objectives: state.objectives,
    vocabulary: state.vocabulary,
    outline: state.phases.map(({ summary: _summary, ...entry }) => ({
      ...entry,
      factRefs: entry.factRefs.filter((ref) => live.has(ref)),
    })),
  };
}

export const stepIndex = (step: PlanStepId): number => STEP_IDS.indexOf(step);
export const BLOCK_TYPES = GENERATABLE_BLOCK_TYPES;
