import type { LessonShape, PriorConfidence } from "../shapes";

/*
 * The lesson shape as the Plan prompts see it (project "Lesson shape by objective verb",
 * TEACH-229): one plain sentence per `LessonShape` field that applies, and nothing else about the
 * verb. Every sentence here is also a rule `planSkeletonSchemaFor` / `planFactsSchemaFor` checks,
 * so the model reads what the retry will name. Rendered inside `briefBlock`, so both Plan calls
 * see the same shape; any wording change here bumps `plan-skeleton` and `plan-facts`.
 *
 * UX ruling 82: a lesson's size is its slide count, and no slide carries minutes, so the explain
 * and practise floors are shares of the slides after the title and objectives slides. When the
 * brief fixes the count the sentences give whole slides (`slidesFor`, the same floor the schema
 * uses), because a model meets "at least 3 of the 8" more reliably than it does arithmetic on a
 * percentage; without a count they fall back to the percentage.
 */

const CLASS_OF: Record<PriorConfidence, string> = {
  "New to it": "a class new to the topic",
  "Some prior knowledge": "a class with some prior knowledge of the topic",
  Revisiting:
    "a class revisiting the topic, so no definition slide: go straight to the mechanism, method or judgement",
};

/**
 * Where a required kind usually goes, so a validation message can say where to add it. A hint,
 * not a rule: the table's deterministic column names kinds, and a `matching` plenary in the check
 * phase or a vocabulary recap in practise is a plausible outline no schema should send back.
 */
const PHASE_OF_KIND: Record<string, string> = {
  content: "explain",
  "worked-example": "explain",
  "image-text": "explain",
  vocabulary: "starter or explain",
};
export function phaseOfKind(kind: string): string {
  return PHASE_OF_KIND[kind] ?? "practise";
}

/**
 * The slides a percent floor asks for among `taught` slides (the outline after the title and
 * objectives slides): floor(taught × percent / 100), the count `planSkeletonSchemaFor` checks.
 */
export function slidesFor(percent: number, taught: number): number {
  return Math.floor((taught * percent) / 100);
}

/**
 * Sentences the outline is held to; each maps to one refinement in `planSkeletonSchemaFor`.
 * `slideCount` is the brief's fixed outline length, title and objectives slides included.
 */
export function shapeBlock(shape: LessonShape, slideCount?: number): string[] {
  const lines = [
    `This is ${article(shape.verb)} ${shape.verb} lesson for ${CLASS_OF[shape.confidence]}.`,
  ];
  if (shape.firstExplainKind === "content") {
    lines.push(
      "The first explain-phase slide is a content slide that defines the topic and names two or three examples.",
    );
  }
  const required = shape.requireVocabulary
    ? [...new Set([...shape.requiredKinds, "vocabulary"])]
    : shape.requiredKinds;
  if (required.length > 0) {
    lines.push(`Include at least one of each: ${required.join(", ")}.`);
  }
  if (shape.forbiddenKinds.length > 0) {
    lines.push(
      `Do not include: ${shape.forbiddenKinds.join(", ")}; check with retrieval kinds (matching, fill-gap, multiple-choice, true-false) instead.`,
    );
  }
  if (shape.minContent > 1) lines.push(`${contentSentence(shape)}.`);
  lines.push(
    `At least ${shape.minCheckEntries} slides where pupils answer (the practise and check phases together).`,
  );
  lines.push(...shareLines(shape, slideCount));
  if (shape.requireWorkedExampleBeforePractise) {
    lines.push(
      "The worked-example is the method, with steps, and comes before any practise slide; in a subject without calculations it annotates a model answer step by step.",
    );
  }
  if (shape.requireMisconceptionConfronted) {
    lines.push(
      "Confront the misconception on a true-false slide or as a multiple-choice distractor.",
    );
  }
  if (shape.requireTwoCases)
    lines.push(
      `Teach the criteria for the judgement on a content slide, then set two cases against each other: ${TWO_CASES}.`,
    );
  if (shape.judgementStem !== null) {
    lines.push(
      shape.young
        ? `The judgement task is an open-response whose stem asks "${shape.judgementStem}"; the class is young, so one reason is enough and no justified true-false is needed.`
        : `The judgement task is an open-response whose stem asks "${shape.judgementStem}".`,
    );
  }
  return lines;
}

/**
 * The explain and practise floors in slides (ruling 82). Explain counts by kind, practise by phase,
 * as the system prompt defines them. A floor that rounds down to no slides says nothing.
 */
function shareLines(shape: LessonShape, slideCount: number | undefined): string[] {
  const lines: string[] = [];
  if (slideCount === undefined) {
    lines.push(
      `At least ${shape.explainMinPercent}% of the slides after the title and objectives slides are explain slides.`,
    );
    if (shape.practiseMinPercent > 0) {
      lines.push(
        `At least ${shape.practiseMinPercent}% of the slides after the title and objectives slides are in the practise phase.`,
      );
    }
    return lines;
  }
  const taught = Math.max(slideCount - 2, 0);
  const explain = slidesFor(shape.explainMinPercent, taught);
  const practise = slidesFor(shape.practiseMinPercent, taught);
  if (explain > 0) {
    lines.push(explainSentence(explain, taught));
  }
  if (practise > 0) {
    lines.push(practiseSentence(practise, taught));
  }
  return lines;
}

/** The explain-floor sentence; `refineShape` opens its issue with the same text. */
export function explainSentence(floor: number, counted: number): string {
  return `At least ${floor} of the ${counted} slides after the title and objectives slides ${floor === 1 ? "is an explain slide" : "are explain slides"}.`;
}

/** The practise-floor sentence; `refineShape` opens its issue with the same text. */
export function practiseSentence(floor: number, counted: number): string {
  return `At least ${floor} of the ${counted} slides after the title and objectives slides ${floor === 1 ? "is" : "are"} in the practise phase.`;
}

/**
 * What the content slides are for, by whether the explain phase opens with a definition: a class
 * revisiting the topic gets no definition slide, so its content slides are all mechanism.
 */
export function contentSentence(shape: LessonShape): string {
  return shape.firstExplainKind === "content"
    ? `At least ${shape.minContent} content slides: the definition first, then the mechanism (how or why) on its own slide`
    : `At least ${shape.minContent} content slides, each explaining one mechanism (how or why)`;
}

/** The two-cases requirement (Evaluate): a prompt rule since TEACH-237, not a validation. */
const TWO_CASES = "a matching or sort slide, or two worked-example slides";

/** The question-tier target line the facts call gets (`plan-facts`). */
export function tierLine(shape: LessonShape): string {
  const { easy, core, stretch } = shape.tierWeights;
  return `Question tiers: ${easy} easy, ${core} core, ${stretch} stretch (at least 12 in all).`;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
