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
};

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
