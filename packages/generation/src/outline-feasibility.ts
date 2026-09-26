import {
  KEY_IDEAS_PER_CONTENT,
  type OutlineFacts,
  type OutlineFromFactsInput,
} from "./outline-from-facts";
import { slidesFor } from "./prompts/shape";

/*
 * An exhaustive structural check beside `outlineFromFacts` (lab only, fixtures and tests): does ANY
 * allocation of the deck's free slots satisfy the shape's floors, given what the facts declare?
 * The greedy fill can miss an allocation; a facts list can make every allocation impossible. The
 * two are told apart here, so a failing fixture is reported as "no allocation satisfies the
 * floors" or "the greedy fill missed one". Tiny by construction: at most 12 slides, so at most
 * nine free slots, and the search is over counts per objective, not over orderings — the running
 * order is fixed by phase and never the reason a floor fails.
 *
 * Everything counted is what the facts declare: a key idea's objective, a worked example's
 * owner (its `objectiveRefs`, else the objective of the misconception it corrects), a question's
 * declared `forms`. Nothing is inferred from text.
 */

/** The fixed slots: title, objectives and the closing exit ticket (as `outlineFromFacts`). */
const FIXED_SLOTS = 3;
const SHARED_STEM_MAX = 120;
const SHARED_PRACTISE_MAX = 4;

export type OutlineFloor =
  | "every objective taught"
  | "every key idea taught"
  | "vocabulary slide"
  | "worked-example slide"
  | "open-response slide"
  | "content slides"
  | "slides where pupils answer"
  | "explain share"
  | "practise share";

/** One allocation of the free slots, by count. */
export type OutlineAllocation = {
  /** Per objective: content, worked-example and practise slides. */
  content: number[];
  workedExample: number[];
  practise: number[];
  vocabulary: 0 | 1;
  /** The shared practise slide (ruling 81): 1 when placed, covering `sharedCovers` objectives. */
  shared: 0 | 1;
  sharedCovers: number;
  /** Whether one of the practise slides is open-response. */
  open: boolean;
};

export type OutlineFeasibility = {
  /** Free slots after the fixed three. */
  slots: number;
  feasible: boolean;
  /** The floors the best allocation still misses (empty when feasible). */
  unmet: OutlineFloor[];
  /** The allocation that misses the fewest floors. */
  best: OutlineAllocation | undefined;
  /** How many allocations were examined. */
  examined: number;
};

export function outlineFeasibility(input: OutlineFromFactsInput): OutlineFeasibility {
  const { facts, shape, slideCount } = input;
  const count = input.objectives.length;
  const all = Array.from({ length: count }, (_, i) => i);
  const slots = Math.max(0, slideCount - FIXED_SLOTS);

  const names = (refs: readonly { index: number }[] | undefined, o: number) =>
    (refs ?? []).some((r) => r.index === o);
  const ownerOf = (x: OutlineFacts["workedExamples"][number]): number[] => {
    const own = [...new Set((x.objectiveRefs ?? []).map((r) => r.index))];
    if (own.length > 0) return own;
    const via =
      x.misconceptionRef === undefined
        ? undefined
        : facts.misconceptions[x.misconceptionRef.index]?.objectiveRefs[0]?.index;
    return via === undefined ? [] : [via];
  };
  const isSlide = (q: OutlineFacts["questions"][number]) => q.use === "slide" || q.use === "any";
  const usable = (q: OutlineFacts["questions"][number]) => isSlide(q) || q.use === "worksheet";
  const admitsOpen = (q: OutlineFacts["questions"][number]) =>
    (q.forms ?? []).length > 0
      ? (q.forms ?? []).includes("open-response")
      : (q.distractors ?? []).length < 3;

  const keyIdeas = all.map((o) => facts.keyIdeas.filter((k) => names(k.objectiveRefs, o)).length);
  const workedExamples = all.map(
    (o) => facts.workedExamples.filter((x) => ownerOf(x).includes(o)).length,
  );
  const questions = all.map(
    (o) => facts.questions.filter((q) => usable(q) && names(q.objectiveRefs, o)).length,
  );
  const openQuestions = all.map(
    (o) =>
      facts.questions.filter((q) => isSlide(q) && admitsOpen(q) && names(q.objectiveRefs, o))
        .length,
  );
  const shortQuestions = all.map(
    (o) =>
      facts.questions.filter(
        (q) => usable(q) && names(q.objectiveRefs, o) && q.stem.length <= SHARED_STEM_MAX,
      ).length,
  );
  const hasVocabulary = facts.vocabulary.length > 0;

  const required = new Set<string>(shape.requiredKinds);
  if (shape.requireVocabulary) required.add("vocabulary");
  const taughtSlides = Math.max(0, slideCount - 2);
  const explainFloor = slidesFor(shape.explainMinPercent, taughtSlides);
  const practiseFloor =
    shape.practiseMinPercent > 0 ? slidesFor(shape.practiseMinPercent, taughtSlides) : 0;

  /** The floors an allocation misses, in a fixed order. */
  const unmetOf = (a: OutlineAllocation): OutlineFloor[] => {
    const unmet: OutlineFloor[] = [];
    if (all.some((o) => (a.content[o] ?? 0) + (a.workedExample[o] ?? 0) === 0)) {
      unmet.push("every objective taught");
    }
    // A content slide carries up to two of its objective's key ideas (np1 RC1).
    if (all.some((o) => (a.content[o] ?? 0) * KEY_IDEAS_PER_CONTENT < (keyIdeas[o] ?? 0))) {
      unmet.push("every key idea taught");
    }
    if (required.has("vocabulary") && a.vocabulary === 0) unmet.push("vocabulary slide");
    const we = a.workedExample.reduce((s, n) => s + n, 0);
    if (required.has("worked-example") && we === 0) unmet.push("worked-example slide");
    if (required.has("open-response") && !a.open) unmet.push("open-response slide");
    const content = a.content.reduce((s, n) => s + n, 0);
    if (content < shape.minContent) unmet.push("content slides");
    const practise = a.practise.reduce((s, n) => s + n, 0) + a.shared;
    if (practise + 1 < shape.minCheckEntries) unmet.push("slides where pupils answer");
    if (content + we + a.vocabulary < explainFloor) unmet.push("explain share");
    if (practise < practiseFloor) unmet.push("practise share");
    return unmet;
  };

  let best: { allocation: OutlineAllocation; unmet: OutlineFloor[] } | undefined;
  let examined = 0;
  const consider = (a: OutlineAllocation) => {
    examined++;
    const unmet = unmetOf(a);
    if (best === undefined || unmet.length < best.unmet.length) {
      best = { allocation: structuredClone(a), unmet };
    }
  };

  // Every free slot beyond what is allocated here is fillable (a starter, a plenary, a discussion),
  // so an allocation using at most `slots` is a deck of exactly `slideCount`.
  const shortObjectives = all.filter((o) => (shortQuestions[o] ?? 0) > 0).length;
  const sharedOptions: [0 | 1, number][] =
    shortObjectives >= 2
      ? [
          [0, 0],
          [1, Math.min(shortObjectives, SHARED_PRACTISE_MAX)],
        ]
      : [[0, 0]];
  const vocabularyOptions: (0 | 1)[] = hasVocabulary ? [0, 1] : [0];

  const a: OutlineAllocation = {
    content: all.map(() => 0),
    workedExample: all.map(() => 0),
    practise: all.map(() => 0),
    vocabulary: 0,
    shared: 0,
    sharedCovers: 0,
    open: false,
  };
  const perObjective = (o: number, used: number, openTaken: boolean) => {
    if (o === count) {
      a.open = openTaken;
      consider(a);
      return;
    }
    const left = slots - used;
    // The useful maxima: beyond them no floor moves.
    const cMax = Math.min(
      keyIdeas[o] ?? 0,
      left,
      Math.max(
        shape.minContent,
        explainFloor,
        Math.ceil((keyIdeas[o] ?? 0) / KEY_IDEAS_PER_CONTENT),
        1,
      ),
    );
    for (let c = 0; c <= cMax; c++) {
      const wMax = Math.min(workedExamples[o] ?? 0, left - c, Math.max(explainFloor, 1));
      for (let w = 0; w <= wMax; w++) {
        // A question the shared slide takes is not available to a practise slide of its own.
        const pool = (questions[o] ?? 0) - (a.shared === 1 && (shortQuestions[o] ?? 0) > 0 ? 1 : 0);
        const pMax = Math.min(
          Math.max(0, pool),
          left - c - w,
          Math.max(practiseFloor, shape.minCheckEntries, 1),
        );
        for (let p = 0; p <= pMax; p++) {
          a.content[o] = c;
          a.workedExample[o] = w;
          a.practise[o] = p;
          const canOpen = !openTaken && p > 0 && (openQuestions[o] ?? 0) > 0;
          perObjective(o + 1, used + c + w + p, openTaken);
          if (canOpen) perObjective(o + 1, used + c + w + p, true);
        }
      }
    }
    a.content[o] = 0;
    a.workedExample[o] = 0;
    a.practise[o] = 0;
  };
  for (const vocabulary of vocabularyOptions) {
    for (const [shared, covers] of sharedOptions) {
      a.vocabulary = vocabulary;
      a.shared = shared;
      a.sharedCovers = covers;
      const used = vocabulary + shared;
      if (used > slots) continue;
      perObjective(0, used, false);
    }
  }

  const result = best as { allocation: OutlineAllocation; unmet: OutlineFloor[] } | undefined;
  return {
    slots,
    feasible: result !== undefined && result.unmet.length === 0,
    unmet: result?.unmet ?? [],
    best: result?.allocation,
    examined,
  };
}
