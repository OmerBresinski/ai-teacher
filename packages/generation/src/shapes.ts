/**
 * Lesson shape by objective verb (project "Lesson shape by objective verb", TEACH-228).
 *
 * The brief screen asks two clarifying questions — `objectiveVerb` (Recall / Explain / Apply /
 * Evaluate) and `priorConfidence` (New to it / Some prior knowledge / Revisiting) — and stores the
 * answers under those ids in `brief.answers`. Until this table Plan received them as two lines of
 * free text and improvised the outline. The table below is the founder's decision (the project
 * description is the source; this file copies it) about what a lesson for each cell must contain
 * and what a schema refinement can check without a model. Nothing here changes behaviour by
 * itself: Plan, Generate and the eval read it (TEACH-229, TEACH-230).
 *
 * Founder decisions of 2026-09-10: Recall forbids `open-response`; Apply's method slide is a
 * `worked-example` in every subject; Evaluate softens below Year 5 (age bands `eyfs`, `ks1`, and
 * `ks2` — Year 5 and 6 are ks2 too, so the softening is by `yearGroup` where known, else by band).
 */
import type { AgeBand, SlideKind } from "@tj/domain/documents";

export const OBJECTIVE_VERBS = ["Recall", "Explain", "Apply", "Evaluate"] as const;
export type ObjectiveVerb = (typeof OBJECTIVE_VERBS)[number];

export const PRIOR_CONFIDENCES = ["New to it", "Some prior knowledge", "Revisiting"] as const;
export type PriorConfidence = (typeof PRIOR_CONFIDENCES)[number];

/** The web suggests these when the teacher answers nothing (`brief-questions.ts`). */
export const DEFAULT_VERB: ObjectiveVerb = "Explain";
export const DEFAULT_CONFIDENCE: PriorConfidence = "Some prior knowledge";

export type TierWeights = { easy: number; core: number; stretch: number };

export type LessonShape = {
  verb: ObjectiveVerb;
  confidence: PriorConfidence;
  /** Whether the softened (younger-class) Evaluate variant applies. */
  young: boolean;
  /**
   * What the first explain-phase slide must be: a `content` slide that defines the topic and names
   * examples, or nothing in particular.
   */
  firstExplainKind: "content" | null;
  /** Kinds the outline must contain at least once. */
  requiredKinds: SlideKind[];
  /** Kinds the outline may not contain. */
  forbiddenKinds: SlideKind[];
  minContent: number;
  minCheckEntries: number;
  /**
   * The explain and practise floors, counted in slides (ruling 82): a percent of the outline's
   * slides after the title and objectives slides, the exit ticket included, rounded down
   * (`slideShare` in `specs.ts`). Explain counts teaching kinds in the explain phase; practise
   * counts every practise-phase slide. The names are kept from when the floors were minutes.
   */
  explainMinPercent: number;
  practiseMinPercent: number;
  /** Apply: the method comes before any practice. */
  requireWorkedExampleBeforePractise: boolean;
  requireVocabulary: boolean;
  /** Explain: a `true-false`, or a multiple-choice distractor tied to a misconception. */
  requireMisconceptionConfronted: boolean;
  /** Evaluate: a `matching` or `sort`, or two `worked-example`s. */
  requireTwoCases: boolean;
  /** Target question counts per tier (the facts prompt's "four easy, five core, three stretch"). */
  tierWeights: TierWeights;
  /** The open-response stem shape the writers are told (Evaluate only; softened when young). */
  judgementStem: "which … and why" | "which … and one reason" | null;
  /** l6d: set only by `withFlow`, from the objectives call's `flow`; absent, the outline runs as before. */
  opener?: Opener | undefined;
  /** l6d: the objectives (0-based) whose cycle ends in a check; the others get none mid-lesson. */
  checkAfter?: number[] | undefined;
  /** l6d: the closing check's form; absent, the exit quiz. */
  close?: Close | undefined;
};

/*
 * l6d (Greg, 26 Sep 2026: "it should reflect the topic and year group"): the lesson's flow, chosen
 * by the objectives call from the subject, the kind of topic and the year group, replaces the verb
 * table's kinds and floors. The verb, confidence, tier weights and judgement stem stay the table's.
 * What stays fixed is only what keeps a deck whole: the slide count, every objective taught, and a
 * closing check in the chosen form (the outline falls back to the quiz when the facts cannot
 * supply that form). Counts the table used to set (minimum content slides, answer slides, explain
 * and practise shares) go to their floor, so the budget follows the flow.
 */
export const OPENERS = ["hook", "retrieval", "none"] as const;
export type Opener = (typeof OPENERS)[number];
export const PRACTICE_FORMS = ["questions", "discussion", "both"] as const;
export type PracticeForm = (typeof PRACTICE_FORMS)[number];
/**
 * l6e (round D judged, 5-11 against round C, 9 of 11 on practice): the close always checks every
 * objective with several items. `written` is the exit ticket asked as short written answers, one
 * per objective, answers keyed; `matching` is for Year 2 and below and only when its terms span
 * every objective. The single open exit question (`written` as it was) and the closing `debate`
 * are gone; discussion stays a practice form.
 */
export const CLOSES = ["quiz", "written", "matching"] as const;
export type Close = (typeof CLOSES)[number];

/** The objectives call's `flow`, as written: `checkAfter` holds 1-based objective numbers. */
export type LessonFlow = {
  opener: Opener;
  workedExample: boolean;
  commonMistake: boolean;
  vocabulary: boolean;
  checkAfter: number[];
  practice: PracticeForm;
  close: Close;
};

const FLOW_KINDS: SlideKind[] = ["worked-example", "vocabulary", "open-response"];

/** l6e: the age bands a matching close is for (Year 2 and below). */
const MATCHING_BANDS: readonly string[] = ["eyfs", "ks1"];

/**
 * The shape with the flow's choices in place of the table's. Objective numbers outside
 * `1..objectiveCount` are dropped, and a matching close above Year 2 (`ageBand` not eyfs or ks1;
 * unknown counts as above) is the quiz: structural guards, the model's choice otherwise kept.
 */
export function withFlow(
  shape: LessonShape,
  flow: LessonFlow,
  objectiveCount: number,
  ageBand?: string | undefined,
): LessonShape {
  const kinds: SlideKind[] = [
    ...(flow.workedExample ? (["worked-example"] as const) : []),
    ...(flow.vocabulary ? (["vocabulary"] as const) : []),
    ...(flow.practice === "questions" ? [] : (["open-response"] as const)),
  ];
  const checkAfter = [...new Set(flow.checkAfter)]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= objectiveCount)
    .map((n) => n - 1)
    .sort((a, b) => a - b);
  return {
    ...shape,
    requiredKinds: [...shape.requiredKinds.filter((k) => !FLOW_KINDS.includes(k)), ...kinds],
    requireVocabulary: flow.vocabulary,
    requireWorkedExampleBeforePractise: flow.workedExample,
    requireMisconceptionConfronted: flow.commonMistake,
    minContent: 1,
    minCheckEntries: 1,
    explainMinPercent: 0,
    practiseMinPercent: 0,
    opener: flow.opener,
    checkAfter,
    close:
      flow.close === "matching" && !MATCHING_BANDS.includes(ageBand ?? "") ? "quiz" : flow.close,
  };
}

const BASE: Omit<LessonShape, "verb" | "confidence" | "young"> = {
  firstExplainKind: null,
  requiredKinds: [],
  forbiddenKinds: [],
  minContent: 1,
  minCheckEntries: 2,
  explainMinPercent: 30,
  practiseMinPercent: 0,
  requireWorkedExampleBeforePractise: false,
  requireVocabulary: false,
  requireMisconceptionConfronted: false,
  requireTwoCases: false,
  tierWeights: { easy: 4, core: 5, stretch: 3 },
  judgementStem: null,
};

/** The verb row of the decision table. */
const BY_VERB: Record<ObjectiveVerb, Partial<typeof BASE>> = {
  Recall: {
    firstExplainKind: "content",
    requiredKinds: ["vocabulary"],
    forbiddenKinds: ["open-response"],
    minCheckEntries: 3,
    requireVocabulary: true,
    tierWeights: { easy: 6, core: 4, stretch: 2 },
  },
  Explain: {
    firstExplainKind: "content",
    requiredKinds: ["worked-example", "open-response"],
    minContent: 2,
    requireMisconceptionConfronted: true,
  },
  Apply: {
    requiredKinds: ["worked-example"],
    practiseMinPercent: 40,
    requireWorkedExampleBeforePractise: true,
    tierWeights: { easy: 4, core: 5, stretch: 4 },
  },
  Evaluate: {
    requiredKinds: ["content", "open-response"],
    requireTwoCases: true,
    judgementStem: "which … and why",
    tierWeights: { easy: 3, core: 5, stretch: 4 },
  },
};

/** The confidence row: applied after the verb row. */
const BY_CONFIDENCE: Record<PriorConfidence, (shape: LessonShape) => LessonShape> = {
  "New to it": (s) => ({
    ...s,
    firstExplainKind: "content",
    requiredKinds: union(s.requiredKinds, ["vocabulary"]),
    requireVocabulary: true,
    explainMinPercent: Math.max(s.explainMinPercent, 40),
    tierWeights: { easy: s.tierWeights.easy + 1, core: s.tierWeights.core, stretch: 2 },
  }),
  "Some prior knowledge": (s) => s,
  Revisiting: (s) => ({
    ...s,
    // No definition slide: straight to mechanism, method or judgement.
    firstExplainKind: null,
    requireVocabulary: false,
    requiredKinds: s.requiredKinds.filter((k) => k !== "vocabulary"),
    explainMinPercent: Math.min(s.explainMinPercent, 20),
    practiseMinPercent: Math.max(s.practiseMinPercent, 30),
    tierWeights: { easy: 2, core: s.tierWeights.core, stretch: Math.max(s.tierWeights.stretch, 4) },
  }),
};

/** Below Year 5: Evaluate keeps the two cases, asks for one reason, drops the justified true-false. */
function soften(shape: LessonShape): LessonShape {
  if (shape.verb !== "Evaluate") return shape;
  return { ...shape, young: true, judgementStem: "which … and one reason" };
}

function union<T>(a: T[], b: T[]): T[] {
  return [...new Set([...a, ...b])];
}

export function objectiveVerbOf(answers: Record<string, string> | undefined): ObjectiveVerb {
  const raw = answers?.objectiveVerb?.trim();
  const found = OBJECTIVE_VERBS.find((v) => raw?.startsWith(v));
  return found ?? DEFAULT_VERB;
}

export function priorConfidenceOf(answers: Record<string, string> | undefined): PriorConfidence {
  const raw = answers?.priorConfidence?.trim();
  const found = PRIOR_CONFIDENCES.find((c) => c === raw);
  return found ?? DEFAULT_CONFIDENCE;
}

/**
 * Year 1–4 count as young; Reception and the `eyfs`/`ks1` bands too; ks2 with no year label is
 * not. Only a year label ("Year 4", "Y4", "P4") is read as a year — "Key Stage 3" is not.
 */
export function isYoungClass(yearGroup: string | undefined, ageBand: AgeBand | undefined): boolean {
  const label = (yearGroup ?? "").trim();
  const year = /^(?:year|y|p|primary)\s*(\d{1,2})\b/i.exec(label)?.[1];
  if (year !== undefined) return Number(year) < 5;
  if (/^(reception|nursery|eyfs)\b/i.test(label)) return true;
  return ageBand === "eyfs" || ageBand === "ks1";
}

/**
 * The lesson shape for a brief's answers and class. Pure; `answers` may be missing or partial —
 * the defaults are the ones the brief screen suggests.
 */
export function lessonShapeOf(
  answers: Record<string, string> | undefined,
  klass: { yearGroup?: string | undefined; ageBand?: AgeBand | undefined } = {},
): LessonShape {
  const verb = objectiveVerbOf(answers);
  const confidence = priorConfidenceOf(answers);
  const shaped: LessonShape = {
    ...BASE,
    ...BY_VERB[verb],
    requiredKinds: [...(BY_VERB[verb].requiredKinds ?? [])],
    forbiddenKinds: [...(BY_VERB[verb].forbiddenKinds ?? [])],
    verb,
    confidence,
    young: false,
  };
  const withConfidence = BY_CONFIDENCE[confidence](shaped);
  return isYoungClass(klass.yearGroup, klass.ageBand) ? soften(withConfidence) : withConfidence;
}
