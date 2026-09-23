// The outline step at 48f3355 (the w0 lab runs, 23 Sep), before the w0 option and exit-ticket fixes: the OLD side of `eval/replay-outline.ts --w0`. Frozen; do not edit.
import type {
  CalloutKind,
  GeneratableSlideKind,
  LessonPhase,
  SlideCount,
} from "@tj/domain/documents";
import { QUESTION_TIERS } from "@tj/domain/documents";
import type { QuestionDemand, QuestionForm } from "../../src/merge-objective-facts";
import { explainSentence, practiseSentence, slidesFor } from "../../src/prompts/shape";
import type { LessonShape } from "../../src/shapes";
import {
  EXPLAIN_KINDS,
  type OrdinalRef,
  type PlanFactsLike,
  type PlanSkeleton,
} from "../../src/specs";

/*
 * The outline, built in code from the merged per-objective facts (ADR 0025 §7: the skeleton the
 * facts fill; ADR 0029 item 9: the brief's slide count is exact). Plan used to ask a model for the
 * outline before any fact existed (`plan-skeleton`) and only then for the facts, so the outline
 * promised slides the facts could not always supply. Now the objectives call runs first, one facts
 * call per objective follows (`mergeObjectiveFacts`), and this module decides which fact goes on
 * which slide: one content slide per objective first, then what the lesson's shape (`shapes.ts`)
 * requires, then practice per objective, a starter, and whatever else the facts hold, until the
 * slide count is spent. The result is the same `PlanSkeleton` + `outlineFactRefs` pair
 * `assignFactIds` has always merged, so nothing downstream can tell who wrote the outline. Pure
 * and deterministic: no model call, no I/O; thin facts become sentences in `gaps`, never a throw.
 *
 * Structural only (Greg, 23 Sep): the step reads what the facts declare — objective references,
 * misconception references, a question's declared `forms` and `demand` — and never infers a
 * meaning. A worked example that names no objective (directly or through the misconception it
 * corrects) stays unowned and unplaced; a question is shown only in a form the facts call declared
 * for it (absent: its native form, multiple-choice with three distractors, open otherwise); an open
 * question is a judgement only when its `demand` says so.
 *
 * Every key idea is taught (np1 root cause RC1, 23 Sep). One content slide per objective used to
 * carry only that objective's first key idea, the shape's floors then spent the budget, and the
 * rest of the key ideas never reached a slide while the exit ticket still tested them. Now:
 * - A content slide carries up to `KEY_IDEAS_PER_CONTENT` of its objective's key ideas (a heading
 *   and a body of up to 60 words hold two, `generate-slide` v22; not three). P1 gives each objective one such
 *   slide; P1b gives an objective with more key ideas a further slide, before the shape's kinds and
 *   floors. A key idea taught outranks the shape's extras: pack-sized facts (three per objective)
 *   in a ten-slide deck give up the vocabulary slide or practice, and a gap says so.
 * - Paired key ideas are split back into one-idea slides whenever budget is left (the content
 *   minimum, the explain floor, P6): a long deck teaches one idea per slide, as before.
 * - A question is fair only when the key ideas it tests are on a slide. Since
 *   `plan-facts-objective` v11 a question declares them (`keyIdeaRefs`, merged to lesson indices),
 *   and the gate is exact: a question on the taught idea stays placeable when its sibling idea has
 *   no room. A question without the declaration (saved runs, older facts) falls back to the
 *   objective: fair only when every key idea of every objective it names is on a slide. A question
 *   held back either way is named in a gap.
 */

/** A question as the outline reads it: the facts' fields plus the optional declarations. */
type OutlineQuestion = PlanFactsLike["questions"][number] & {
  forms?: readonly QuestionForm[] | undefined;
  demand?: QuestionDemand | undefined;
  /** The key ideas it tests, as lesson key-idea ordinals (facts v11); absent on older facts. */
  keyIdeaRefs?: readonly OrdinalRef[] | undefined;
};

/** The merged per-objective facts: `PlanFactsLike` before the outline exists. */
export type OutlineFacts = Omit<PlanFactsLike, "outlineFactRefs" | "pitch" | "questions"> & {
  questions: OutlineQuestion[];
};

export type { CalloutKind } from "@tj/domain/documents";
/** A callout with its text, for the lab view and the plan screen; persisted as `outlineFactRefs[].callout`. */
export type Callout = { kind: CalloutKind; ref: OrdinalRef; text: string };

export type OutlineFromFactsInput = {
  topic: string;
  objectives: { text: string }[];
  facts: OutlineFacts;
  shape: LessonShape;
  slideCount: SlideCount;
};

/** Outline positions, per objective. */
export type ObjectiveCoverage = { taught: number[]; practised: number[]; checked: number[] };

export type OutlineFromFactsResult = {
  /** `learningObjectives` copied from the input; `outline` with objective refs, brief and phase; no minutes (ruling 82). No `photographable`. */
  skeleton: PlanSkeleton;
  /** Fact refs per outline position from 2 onwards, in the shape `assignFactIds` merges. */
  outlineFactRefs: PlanFactsLike["outlineFactRefs"];
  /** By outline position; only slides that carry one. */
  callouts: Record<number, Callout>;
  coverage: ObjectiveCoverage[];
  /** Fact indices that got no slide; worksheet-only questions are not counted. */
  unplaced: { keyIdeas: number[]; workedExamples: number[]; questions: number[] };
  /** Plain sentences a log or the plan screen can show: what the facts did not allow. */
  gaps: string[];
};

/** The brief's `adds` / `avoids` cap (`SPEC_LIMITS.item`), restated so this module has no `@tj/slides` import. */
const BRIEF_MAX = 160;
/**
 * The exit ticket's brief names the items to set as multiple choice with their options (an exit
 * question the facts give no open form and no open substitute); the lab check reads it.
 */
export const EXIT_OPTIONS_NOTE = "Multiple choice for objective";
/** The fixed slots: title, objectives and the closing exit ticket. */
const FIXED_SLOTS = 3;
/** How many terms one vocabulary slide shows at most (the widest theme grid). */
const VOCABULARY_TERMS_MAX = 6;
/** Unshown terms a content slide may carry alongside its key idea. */
const TERMS_PER_CONTENT = 2;
/**
 * Key ideas one content slide carries at most: `generate-slide` (v22) gives a content slide that
 * names two key ideas a body of up to 60 words, the first idea in one sentence, then the second.
 */
export const KEY_IDEAS_PER_CONTENT = 2;
/** The longest question stem a shared practise slide takes: four have to fit on one slide. */
const SHARED_STEM_MAX = 120;
/** Objectives one shared practise slide covers at most: an `instructions` slide holds 1–4 steps. */
const SHARED_PRACTISE_MAX = 4;

type Kind = GeneratableSlideKind;

/** A slide the fill has decided on; refs, brief and callout are computed once the order is fixed. */
type Slot = {
  kind: Kind;
  phase: LessonPhase;
  /** The objective the slide sits under in the running order. */
  primary: number;
  /** Every objective the slide names (`skeleton.outline[i].factRefs`). */
  objectives: number[];
  /** A content slide's key ideas, one objective's, at most `KEY_IDEAS_PER_CONTENT`. */
  keyIdeas?: number[];
  workedExample?: number;
  question?: number;
  /** The shared practise slide's questions, one per objective it covers (ruling 81). */
  questions?: number[];
  misconception?: number;
  terms?: number[];
  /** Lexicographic running-order key: phase, objective, then the fact order. */
  rank: number[];
};

export function outlineFromFacts(input: OutlineFromFactsInput): OutlineFromFactsResult {
  const { facts, shape, slideCount, topic } = input;
  const count = input.objectives.length;
  const all = Array.from({ length: count }, (_, i) => i);
  const gaps: string[] = [];
  const gap = (sentence: string) => {
    if (!gaps.includes(sentence)) gaps.push(sentence);
  };
  const nth = (o: number) => `Objective ${o + 1}`;

  const refIndices = (refs: readonly OrdinalRef[] | undefined) =>
    dedupe((refs ?? []).map((r) => r.index));
  const names = (refs: readonly OrdinalRef[] | undefined, o: number) =>
    (refs ?? []).some((r) => r.index === o);

  // Worked examples are attributed by their own `objectiveRefs`; a list written before those
  // existed is attributed through the misconception it says it corrects. One that names neither
  // is unowned: no slide carries it (`unplaced.workedExamples`) and a gap says so. Guessing an
  // owner from position is a judgement the code does not make.
  const ownersOf: number[][] = [];
  facts.workedExamples.forEach((x, i) => {
    const own = refIndices(x.objectiveRefs);
    if (own.length > 0) {
      ownersOf.push(own);
      return;
    }
    const viaMisconception =
      x.misconceptionRef === undefined
        ? undefined
        : facts.misconceptions[x.misconceptionRef.index]?.objectiveRefs[0]?.index;
    if (viaMisconception !== undefined) {
      ownersOf.push([viaMisconception]);
      return;
    }
    ownersOf.push([]);
    gap(`Worked example ${i + 1} names no objective, so no slide carries it.`);
  });
  const ownedWorkedExamples = ownersOf.flatMap((owners, i) => (owners.length > 0 ? [i] : []));

  const isSlideQuestion = (q: OutlineFacts["questions"][number]) =>
    q.use === "slide" || q.use === "any";
  const keyIdeasOf = (o: number) =>
    facts.keyIdeas.flatMap((k, i) => (names(k.objectiveRefs, o) ? [i] : []));
  const questionsOf = (o: number) =>
    facts.questions.flatMap((q, i) => (isSlideQuestion(q) && names(q.objectiveRefs, o) ? [i] : []));
  const exitOf = (o: number) =>
    facts.questions.flatMap((q, i) => (q.use === "exit" && names(q.objectiveRefs, o) ? [i] : []));
  const misconceptionsOf = (o: number) =>
    facts.misconceptions.flatMap((m, i) => (names(m.objectiveRefs, o) ? [i] : []));

  // What the facts lack per objective, said once, whatever the budget does later.
  for (const o of all) {
    if (keyIdeasOf(o).length === 0)
      gap(`${nth(o)} has no key idea, so no content slide teaches it.`);
    if (questionsOf(o).length === 0) {
      gap(`${nth(o)} has no slide question, so no practise slide checks it.`);
    }
    if (exitOf(o).length === 0) {
      gap(`${nth(o)} has no exit question, so the exit ticket cannot check it.`);
    }
  }

  /* ---- the fill ---- */

  const slots: Slot[] = [];
  const used = {
    keyIdeas: new Set<number>(),
    workedExamples: new Set<number>(),
    questions: new Set<number>(),
  };
  let budget = Math.max(0, slideCount - FIXED_SLOTS);
  const has = (kind: Kind) => slots.some((s) => s.kind === kind);
  const countOf = (kind: Kind) => slots.filter((s) => s.kind === kind).length;
  const practiseCount = () => slots.filter((s) => s.phase === "practise").length;
  const taught = (o: number) =>
    slots.some(
      (s) => (s.kind === "content" || s.kind === "worked-example") && s.objectives.includes(o),
    );
  const practised = (o: number) =>
    slots.some((s) => s.phase === "practise" && s.objectives.includes(o));
  const place = (slot: Slot): boolean => {
    if (budget <= 0) return false;
    slots.push(slot);
    budget -= 1;
    for (const k of slot.keyIdeas ?? []) used.keyIdeas.add(k);
    if (slot.workedExample !== undefined) used.workedExamples.add(slot.workedExample);
    if (slot.question !== undefined) used.questions.add(slot.question);
    for (const q of slot.questions ?? []) used.questions.add(q);
    return true;
  };

  const contentSlot = (o: number, ks: number[]): Slot => ({
    kind: "content",
    phase: "explain",
    primary: o,
    objectives: dedupe(ks.flatMap((k) => refIndices(facts.keyIdeas[k]?.objectiveRefs))),
    keyIdeas: ks,
    rank: [1, o, 0, ks[0] ?? 0],
  });
  const workedExampleSlot = (o: number, x: number): Slot => ({
    kind: "worked-example",
    phase: "explain",
    primary: o,
    objectives: ownersOf[x] ?? [o],
    workedExample: x,
    rank: [1, o, 1, x],
  });
  /**
   * The forms question `i` may be shown in: what the facts call declared, else its native form.
   * A true/false slide also needs a distractor tied to a misconception (that is what the slide
   * confronts); a declared form without one is not usable.
   */
  const formsOf = (i: number): QuestionForm[] => {
    const q = facts.questions[i];
    const distractors = q?.distractors ?? [];
    const declared = q?.forms ?? [];
    const tagged = distractors.some((d) => d.misconceptionRef !== undefined);
    const forms: QuestionForm[] =
      declared.length > 0
        ? [...declared]
        : [distractors.length >= 3 ? "multiple-choice" : "open-response"];
    return forms.filter((f) => f !== "true-false" || tagged);
  };
  const admitsOpen = (i: number) => formsOf(i).includes("open-response");
  /**
   * Question `i` has a form a practise slide can show: open, true/false, or multiple choice with
   * the three distractors a four-option slide needs. A multiple-choice-only question with fewer
   * would fall back to a stem with no options.
   */
  const showable = (i: number) => {
    const forms = formsOf(i);
    return (
      forms.includes("open-response") ||
      forms.includes("true-false") ||
      (forms.includes("multiple-choice") && (facts.questions[i]?.distractors?.length ?? 0) >= 3)
    );
  };
  /** A practise slide from question `i` in one of its declared forms (`open` asks for open-response). */
  const questionSlot = (o: number, i: number, open = false): Slot => {
    const q = facts.questions[i];
    const distractors = q?.distractors ?? [];
    const tagged = distractors.find((d) => d.misconceptionRef !== undefined);
    const forms = formsOf(i);
    let kind: Kind;
    let misconception: number | undefined;
    if (open && forms.includes("open-response")) {
      kind = "open-response";
    } else if (
      shape.requireMisconceptionConfronted &&
      !has("true-false") &&
      forms.includes("true-false") &&
      tagged
    ) {
      kind = "true-false";
      misconception = tagged.misconceptionRef?.index;
    } else if (forms.includes("multiple-choice") && distractors.length >= 3) {
      kind = "multiple-choice";
    } else if (shape.forbiddenKinds.includes("open-response")) {
      kind = "discussion";
    } else {
      kind = "open-response";
    }
    const seq = slots.length;
    // A question the facts call declared a judgement closes the practise phase.
    const last = kind === "open-response" && q?.demand === "judgement";
    return {
      kind,
      phase: "practise",
      primary: o,
      objectives: refIndices(q?.objectiveRefs),
      question: i,
      ...(misconception === undefined ? {} : { misconception }),
      rank: [2, last ? count : o, seq],
    };
  };
  const practiseSlidesOf = (o: number) =>
    slots.filter((s) => s.phase === "practise" && s.objectives.includes(o)).length;
  /** Tier order easy → core → stretch; a question without a tier sits with core. */
  const tierRank = (i: number) => {
    const tier = facts.questions[i]?.tier;
    return tier === undefined ? 1 : QUESTION_TIERS.indexOf(tier);
  };
  /**
   * The practise floor's last resort: an unused `worksheet` question for the objective with the
   * fewest practise slides, easiest tier first.
   */
  const worksheetFallback = (): [number, number] | undefined => {
    const byNeed = [...all].sort((a, b) => practiseSlidesOf(a) - practiseSlidesOf(b) || a - b);
    for (const o of byNeed) {
      const i = worksheetQuestionOf(o);
      if (i !== undefined) return [o, i];
    }
    return undefined;
  };
  /** An unused `worksheet` question on objective `o`, easiest tier first. */
  const worksheetQuestionOf = (o: number) =>
    facts.questions
      .flatMap((q, j) =>
        q.use === "worksheet" &&
        !used.questions.has(j) &&
        names(q.objectiveRefs, o) &&
        showable(j) &&
        fair(j)
          ? [j]
          : [],
      )
      .sort((a, b) => tierRank(a) - tierRank(b) || a - b)[0];
  const unusedKeyIdeas = (o: number) => keyIdeasOf(o).filter((k) => !used.keyIdeas.has(k));
  /** Every key idea of objective `o` is on a slide (an objective with none has nothing left off). */
  const fullyTaught = (o: number) => unusedKeyIdeas(o).length === 0;
  /** The key ideas question `i` declares it tests (facts v11), or none when it declares none. */
  const testedKeyIdeas = (i: number) =>
    refIndices(facts.questions[i]?.keyIdeaRefs).filter((k) => k < facts.keyIdeas.length);
  /**
   * Question `i` may go on a slide: every key idea it declares is on a slide; without that
   * declaration, every objective it names is fully taught (it may test any of their key ideas).
   */
  const fair = (i: number) => {
    const tested = testedKeyIdeas(i);
    return tested.length > 0
      ? tested.every((k) => used.keyIdeas.has(k))
      : refIndices(facts.questions[i]?.objectiveRefs).every((o) => fullyTaught(o));
  };
  const firstUnusedQuestion = (o: number) =>
    questionsOf(o).find((i) => !used.questions.has(i) && showable(i) && fair(i));
  const pickWorkedExample = (among: number[]) => {
    const free = among.filter((x) => !used.workedExamples.has(x));
    return free.find((x) => facts.workedExamples[x]?.misconceptionRef !== undefined) ?? free[0];
  };
  /**
   * The next key ideas to teach: the objective with the fewest content slides that still has one,
   * with up to `KEY_IDEAS_PER_CONTENT` of its unplaced key ideas (`single`: one).
   */
  const nextKeyIdeas = (single = false): [number, number[]] | undefined => {
    const o = all
      .filter((candidate) => unusedKeyIdeas(candidate).length > 0)
      .sort((a, b) => contentSlidesOf(a) - contentSlidesOf(b) || a - b)[0];
    if (o === undefined) return undefined;
    return [o, unusedKeyIdeas(o).slice(0, single ? 1 : KEY_IDEAS_PER_CONTENT)];
  };
  /** A content slide carrying two key ideas, the objective with the fewest content slides first. */
  const pairedSlot = () =>
    slots
      .filter((s) => s.kind === "content" && (s.keyIdeas?.length ?? 0) > 1)
      .sort(
        (a, b) => contentSlidesOf(a.primary) - contentSlidesOf(b.primary) || a.primary - b.primary,
      )[0];
  /**
   * One more teaching slide: an unplaced key idea on a slide of its own, else a paired content
   * slide split in two. `none` when every key idea already has a slide to itself.
   */
  const teachMore = (): "placed" | "full" | "none" => {
    const next = nextKeyIdeas(true);
    if (next !== undefined) return place(contentSlot(next[0], next[1])) ? "placed" : "full";
    const paired = pairedSlot();
    if (paired === undefined) return "none";
    if (budget <= 0) return "full";
    const ks = paired.keyIdeas ?? [];
    const moved = ks.slice(1);
    paired.keyIdeas = ks.slice(0, 1);
    paired.objectives = dedupe(
      paired.keyIdeas.flatMap((k) => refIndices(facts.keyIdeas[k]?.objectiveRefs)),
    );
    place(contentSlot(paired.primary, moved));
    return "placed";
  };
  const contentSlidesOf = (o: number) =>
    slots.filter((s) => s.kind === "content" && s.objectives.includes(o)).length;

  const required = new Set<string>(shape.requiredKinds);
  if (shape.requireVocabulary) required.add("vocabulary");
  const anyOpenQuestion = facts.questions.some((q, i) => isSlideQuestion(q) && admitsOpen(i));
  const needVocabulary = required.has("vocabulary") && facts.vocabulary.length > 0;
  const needWorkedExample = required.has("worked-example") && ownedWorkedExamples.length > 0;
  const needOpen = required.has("open-response") && anyOpenQuestion;
  const noRoom = (kind: string) =>
    gap(`The shape needs a ${kind} slide and a ${slideCount}-slide deck has no room for one.`);
  const noMaterial = (kind: string, material: string) =>
    gap(`The shape needs a ${kind} slide and the facts have no ${material}.`);

  // The shape's floors, counted in slides (ruling 82), of the slides after title and objectives.
  const taughtSlides = Math.max(0, slideCount - 2);
  const explainFloor = slidesFor(shape.explainMinPercent, taughtSlides);
  const practiseFloor = slidesFor(shape.practiseMinPercent, taughtSlides);

  /**
   * One slot kept for a practise slide while there is none yet: the skeleton needs one
   * (`PlanSkeletonSchema`) unless teaching takes every slot. `anyQuestion` counts every question
   * that is not an exit question (the key ideas are still being placed, so fairness is not known
   * yet); otherwise only a fair, unused one.
   */
  const practiseReserve = (anyQuestion = false) =>
    !slots.some((s) => s.phase === "practise") &&
    facts.questions.some(
      (q, i) => q.use !== "exit" && !used.questions.has(i) && (anyQuestion || fair(i)),
    )
      ? 1
      : 0;

  // P1: every objective taught, in order, each content slide carrying up to two of its key ideas.
  // (A short deck used to let the required worked example teach its objective in place of a
  // content slide; the objective's key ideas then went untaught, so it no longer does.)
  for (const o of all) {
    if (taught(o)) continue;
    const ks = unusedKeyIdeas(o).slice(0, KEY_IDEAS_PER_CONTENT);
    if (ks.length > 0) place(contentSlot(o, ks));
  }
  // P1b: every key idea taught — an objective with more than one slide's worth gets another,
  // before the shape's kinds and floors, keeping one slot for practice. A question on an untaught
  // key idea is worse than a missing vocabulary slide or worked example, which are only gaps.
  for (
    let next = nextKeyIdeas();
    budget > practiseReserve(true) && next !== undefined;
    next = nextKeyIdeas()
  ) {
    place(contentSlot(next[0], next[1]));
  }
  // Four objectives in a six-slide deck: the budget runs out inside P1. Said per objective, so
  // the plan screen can name the one that is not taught rather than the teacher finding out.
  for (const o of all) {
    if (!taught(o) && keyIdeasOf(o).length > 0) {
      gap(`${nth(o)} has a key idea but a ${slideCount}-slide deck has no room to teach it.`);
    }
  }

  // P2: the shape's required kinds and floors. The worked example before the vocabulary slide: a
  // content slide hands out its objective's unshown terms, nothing else gives the method. Neither
  // takes the slot kept for practice.
  if (required.has("worked-example") && !has("worked-example")) {
    if (!needWorkedExample) {
      noMaterial(
        "worked-example",
        facts.workedExamples.length > 0
          ? "worked example that names an objective"
          : "worked example",
      );
    } else {
      const x = pickWorkedExample(ownedWorkedExamples);
      const o = x === undefined ? undefined : ownersOf[x]?.[0];
      if (
        x === undefined ||
        o === undefined ||
        budget <= practiseReserve() ||
        !place(workedExampleSlot(o, x))
      ) {
        noRoom("worked-example");
      }
    }
  }
  if (required.has("vocabulary")) {
    if (!needVocabulary) noMaterial("vocabulary", "vocabulary terms");
    else {
      const terms = facts.vocabulary.slice(0, VOCABULARY_TERMS_MAX).map((_, i) => i);
      const objectives = dedupe(
        terms.flatMap((i) => refIndices(facts.vocabulary[i]?.objectiveRefs)),
      );
      const placed =
        budget > practiseReserve() &&
        place({
          kind: "vocabulary",
          phase: "explain",
          primary: Math.min(...objectives, count),
          objectives,
          terms,
          rank: [1, -1],
        });
      if (!placed) noRoom("vocabulary");
    }
  }
  // Ruling 81: when the deck has no room for a practise slide per unpractised objective, one
  // shared `instructions` slide asks a question on each (up to four) instead. It comes after the
  // shape's essentials, the open-response included: in an Explain or Evaluate lesson pupils
  // explaining or judging the reach objective in their own words is the lesson's point, and the
  // exit ticket still checks the objectives the shared slide cannot reach.
  const placeSharedPractise = () => {
    if (has("instructions")) return;
    // A question naming two objectives is taken once, for the first of them.
    const taken = new Set<number>();
    const pending = all.flatMap((o): [number, number][] => {
      if (practised(o)) return [];
      // Four verbatim stems share one slide, and an `instructions` step is capped at an item's
      // length, so only a short question goes on it; an objective with none is left to the exit
      // ticket rather than overflowing the slide.
      const short = (i: number | undefined) =>
        i !== undefined && (facts.questions[i]?.stem.length ?? Infinity) <= SHARED_STEM_MAX;
      // The slide prints stems only, so a question joins it only when the facts let it be asked
      // openly (`admitsOpen`): a multiple-choice-native stem there would have no options.
      const i =
        questionsOf(o).find(
          (j) => !used.questions.has(j) && !taken.has(j) && short(j) && admitsOpen(j) && fair(j),
        ) ??
        facts.questions
          .flatMap((q, j) =>
            q.use === "worksheet" &&
            !used.questions.has(j) &&
            !taken.has(j) &&
            names(q.objectiveRefs, o) &&
            short(j) &&
            admitsOpen(j) &&
            fair(j)
              ? [j]
              : [],
          )
          .sort((a, b) => tierRank(a) - tierRank(b) || a - b)[0];
      if (i === undefined) return [];
      taken.add(i);
      return [[o, i]];
    });
    if (pending.length < 2 || budget >= pending.length || budget <= 0) return;
    const covered = pending.slice(0, SHARED_PRACTISE_MAX);
    place({
      kind: "instructions",
      phase: "practise",
      primary: covered[0]?.[0] ?? 0,
      objectives: covered.map(([o]) => o),
      questions: covered.map(([, i]) => i),
      rank: [2, covered[0]?.[0] ?? 0, slots.length],
    });
  };
  if (required.has("open-response") && !has("open-response")) {
    if (!needOpen) noMaterial("open-response", "question that can be asked openly");
    else if (budget <= 0) noRoom("open-response");
    else {
      // A question the facts declared askable openly (`forms`), or wrote without distractors.
      // One declared a judgement first, then the last objective's, then any: the order is a
      // structural preference, the form is never inferred from the question's content.
      let slot: Slot | undefined;
      const open = (o: number) =>
        questionsOf(o).filter((i) => !used.questions.has(i) && admitsOpen(i) && fair(i));
      const judged = all.flatMap((o) =>
        open(o).flatMap((i) => (facts.questions[i]?.demand === "judgement" ? [[o, i]] : [])),
      )[0];
      if (judged !== undefined) slot = questionSlot(judged[0] ?? 0, judged[1] ?? 0, true);
      else {
        for (const o of [...all].reverse()) {
          const i = open(o)[0];
          if (i !== undefined) {
            slot = questionSlot(o, i, true);
            break;
          }
        }
      }
      if (slot === undefined) noMaterial("open-response", "question left to ask openly");
      else if (!place(slot)) noRoom("open-response");
    }
  }
  placeSharedPractise();

  // Enough slides where pupils answer, the exit ticket counted.
  while (practiseCount() + 1 < shape.minCheckEntries) {
    if (budget <= 0) {
      gap(
        `The shape needs ${shape.minCheckEntries} slides where pupils answer and a ${slideCount}-slide deck has room for ${practiseCount() + 1}.`,
      );
      break;
    }
    const o = [...all]
      .sort((a, b) => Number(practised(a)) - Number(practised(b)) || a - b)
      .find((candidate) => firstUnusedQuestion(candidate) !== undefined);
    const i = o === undefined ? undefined : firstUnusedQuestion(o);
    if (o === undefined || i === undefined) {
      gap(
        `The shape needs ${shape.minCheckEntries} slides where pupils answer and the facts have questions for ${practiseCount() + 1}.`,
      );
      break;
    }
    if (!place(questionSlot(o, i))) {
      gap(
        `The shape needs ${shape.minCheckEntries} slides where pupils answer and a ${slideCount}-slide deck has room for ${practiseCount() + 1}.`,
      );
      break;
    }
  }
  // Enough content slides.
  while (countOf("content") < shape.minContent) {
    const step = teachMore();
    if (step === "placed") continue;
    gap(
      step === "none"
        ? `The shape needs ${shape.minContent} content slides and the facts have key ideas for ${countOf("content")}.`
        : `The shape needs ${shape.minContent} content slides and a ${slideCount}-slide deck has room for ${countOf("content")}.`,
    );
    break;
  }

  // The shape's floors, counted in slides (ruling 82): teaching first, so practice is what a
  // short deck gives up (ruling 81).
  /** Whether a floor stopped because the deck was full (else the facts ran out). */
  const shareFull = { explain: false, practise: false };
  const explainCount = () =>
    slots.filter((s) => s.phase === "explain" && EXPLAIN_KINDS.has(s.kind)).length;
  while (explainCount() < explainFloor) {
    const step = teachMore();
    if (step === "placed") continue;
    const x = step === "none" ? pickWorkedExample(ownedWorkedExamples) : undefined;
    if (
      step === "full" ||
      (x !== undefined && !place(workedExampleSlot(ownersOf[x]?.[0] ?? 0, x)))
    ) {
      shareFull.explain = true;
      break;
    }
    if (x === undefined) break;
  }
  while (practiseCount() < practiseFloor) {
    const o = [...all]
      .sort((a, b) => Number(practised(a)) - Number(practised(b)) || a - b)
      .find((candidate) => firstUnusedQuestion(candidate) !== undefined);
    let i = o === undefined ? undefined : firstUnusedQuestion(o);
    let owner = o;
    // The slide questions ran out: a worksheet question fills the floor instead. The worksheet is
    // its own optional job (ADR 0030), so nothing else is sure to use it, and `stemPlan` gives a
    // claimed worksheet question to its slide. Never an exit question.
    if (owner === undefined || i === undefined) [owner, i] = worksheetFallback() ?? [];
    if (owner === undefined || i === undefined) break;
    if (!place(questionSlot(owner, i))) {
      shareFull.practise = true;
      break;
    }
  }

  // P3: every objective practised.
  placeSharedPractise();
  for (const o of all) {
    if (practised(o) || budget <= 0) continue;
    const i = firstUnusedQuestion(o);
    if (i !== undefined) place(questionSlot(o, i));
  }
  for (const o of all) {
    if (!practised(o) && firstUnusedQuestion(o) !== undefined) {
      gap(
        `${nth(o)} has a slide question but a ${slideCount}-slide deck has no room to practise it; the exit ticket is its only check.`,
      );
    }
  }

  // P4: the remaining worked examples — each is the method or the model answer for its objective,
  // worth more than a starter (Macbeth's three model paragraphs all went unplaced behind one).
  for (const x of ownedWorkedExamples) {
    if (budget <= 0) break;
    if (used.workedExamples.has(x)) continue;
    place(workedExampleSlot(ownersOf[x]?.[0] ?? 0, x));
  }

  // P5: the starter — what pupils already think.
  if (budget > 0 && count > 0) {
    place({
      kind: "starter",
      phase: "starter",
      primary: 0,
      objectives: [0],
      ...(facts.misconceptions.length > 0 ? { misconception: 0 } : {}),
      rank: [0],
    });
  }

  // P6: the rest of the facts — paired key ideas split onto slides of their own, round-robin by
  // objective, then questions.
  while (budget > 0 && teachMore() === "placed") {}
  facts.questions.forEach((q, i) => {
    if (budget <= 0 || used.questions.has(i) || !isSlideQuestion(q) || !showable(i) || !fair(i))
      return;
    place(questionSlot(q.objectiveRefs[0]?.index ?? 0, i));
  });

  // P7: discussions on misconceptions nothing else confronts, then a plenary.
  if (budget > 0) {
    const confronted = new Set<number>();
    for (const s of slots) {
      if (s.misconception !== undefined && s.kind !== "starter") confronted.add(s.misconception);
      if (s.workedExample !== undefined) {
        const ref = facts.workedExamples[s.workedExample]?.misconceptionRef;
        if (ref) confronted.add(ref.index);
      }
      // A content slide's watch-out (below) takes its objective's first misconception.
      if (s.kind === "content") {
        const first = misconceptionsOf(s.primary).find((m) => !confronted.has(m));
        if (first !== undefined) confronted.add(first);
      }
    }
    facts.misconceptions.forEach((m, i) => {
      if (budget <= 0 || confronted.has(i)) return;
      const o = m.objectiveRefs[0]?.index ?? 0;
      place({
        kind: "discussion",
        phase: "practise",
        primary: o,
        objectives: refIndices(m.objectiveRefs),
        misconception: i,
        rank: [2, count + 1, i],
      });
    });
  }
  if (budget > 0 && count > 0) {
    place({ kind: "plenary", phase: "check", primary: 0, objectives: all, rank: [3, 0] });
  }

  // P8: a practice set. The facts carry three or four questions per objective and a 10-slide deck
  // gave about three of them a slide each (np1 -ff: 48 of 223 on practise slides); the worksheet
  // that took the rest is its own optional job (ADR 0030). An `instructions` slide holds up to four
  // short stems (ruling 81), so the unused slide and worksheet questions fill one, without a slot of
  // their own: the shared slide when there is one, else the last single-question multiple-choice or
  // open-response slide the shape can spare becomes a set around its question. Exit questions stay
  // for the exit ticket, and a set step is a stem with no options, so only a question the facts
  // declared askable openly joins one. Unpractised objectives first, then the harder tiers (the single-question
  // slides took the easiest); the set is asked easiest first.
  const setPool = () =>
    facts.questions
      .flatMap((q, i) =>
        q.use !== "exit" &&
        !used.questions.has(i) &&
        q.stem.length <= SHARED_STEM_MAX &&
        admitsOpen(i) &&
        fair(i)
          ? [i]
          : [],
      )
      .sort(
        (a, b) =>
          Number(refIndices(facts.questions[a]?.objectiveRefs).every(practised)) -
            Number(refIndices(facts.questions[b]?.objectiveRefs).every(practised)) ||
          tierRank(b) - tierRank(a) ||
          a - b,
      );
  const firstObjective = (i: number) => facts.questions[i]?.objectiveRefs[0]?.index ?? 0;
  const spare = (s: Slot) =>
    s.phase === "practise" &&
    s.question !== undefined &&
    (s.kind === "multiple-choice" || s.kind === "open-response") &&
    facts.questions[s.question]?.demand !== "judgement" &&
    (facts.questions[s.question]?.stem.length ?? Infinity) <= SHARED_STEM_MAX &&
    admitsOpen(s.question) &&
    (!required.has(s.kind) || countOf(s.kind) > 1);
  const pool = shape.forbiddenKinds.includes("instructions") ? [] : setPool();
  const set =
    slots.find((s) => s.kind === "instructions" && s.phase === "practise") ??
    (pool.length >= 2
      ? slots
          .filter(spare)
          .sort(
            (a, b) =>
              Number(a.kind !== "multiple-choice") - Number(b.kind !== "multiple-choice") ||
              compareRanks(b.rank, a.rank),
          )[0]
      : undefined);
  if (set && pool.length > 0) {
    const questions = [
      ...(set.questions ?? (set.question === undefined ? [] : [set.question])),
      ...pool,
    ]
      .slice(0, SHARED_PRACTISE_MAX)
      .sort((a, b) => tierRank(a) - tierRank(b) || firstObjective(a) - firstObjective(b) || a - b);
    for (const i of questions) used.questions.add(i);
    set.kind = "instructions";
    delete set.question;
    set.questions = questions;
    set.objectives = dedupe(
      questions.flatMap((i) => refIndices(facts.questions[i]?.objectiveRefs)),
    ).sort((a, b) => a - b);
  }

  if (budget > 0) {
    gap(
      `The facts allow only ${slots.length + FIXED_SLOTS} slides; the brief asked for ${slideCount}.`,
    );
  }
  // What is still not taught, and the questions that stay off the slides because of it.
  facts.keyIdeas.forEach((k, i) => {
    if (used.keyIdeas.has(i)) return;
    const owners = refIndices(k.objectiveRefs).map((o) => nth(o).toLowerCase());
    gap(
      `Key idea ${i + 1} (${owners.join(", ")}) is on no slide: a ${slideCount}-slide deck has no room for it.`,
    );
  });
  for (const o of all) {
    if (fullyTaught(o)) continue;
    const held = facts.questions.flatMap((q, i) =>
      q.use !== "worksheet" && names(q.objectiveRefs, o) && !fair(i) ? [i] : [],
    );
    if (held.length === 0) continue;
    const untaught = unusedKeyIdeas(o)
      .map((k) => k + 1)
      .join(", ");
    const why = held.every((i) => testedKeyIdeas(i).length > 0)
      ? "they test it."
      : "a question names its objective, not the key idea it tests.";
    gap(
      `${nth(o)}'s questions stay off the practise slides and the exit ticket: key idea ${untaught} is on no slide, and ${why}`,
    );
  }

  /* ---- the running order, refs, briefs, callouts ---- */

  slots.sort((a, b) => compareRanks(a.rank, b.rank));
  const exitPosition = slots.length + 2;

  const shownTerms = new Set(slots.find((s) => s.kind === "vocabulary")?.terms ?? []);
  const handedTerms = new Set<number>();
  const usedMisconceptions = new Set<number>();
  const seenBriefs = new Set<string>();
  const brief = (adds: string, avoids?: string) => {
    const unique = distinctBrief(clip(adds), seenBriefs);
    return avoids === undefined ? { adds: unique } : { adds: unique, avoids: clip(avoids) };
  };
  const objectiveRefs = (objectives: number[]): OrdinalRef[] =>
    objectives.map((index) => ({ type: "objective", index }));

  const outline: PlanSkeleton["outline"] = [
    { kind: "title", factRefs: [] },
    { kind: "objectives", factRefs: objectiveRefs(all) },
  ];
  const outlineFactRefs: PlanFactsLike["outlineFactRefs"] = [];
  const callouts: Record<number, Callout> = {};

  // An open question is a judgement only when the facts call declared its demand so; nothing is
  // read from the objective's position in the lesson.
  const judges = (slot: Slot) =>
    slot.question !== undefined && facts.questions[slot.question]?.demand === "judgement";
  slots.forEach((slot, i) => {
    const position = i + 2;
    const refs: OrdinalRef[] = [];
    let adds = "";
    let avoids: string | undefined;
    switch (slot.kind) {
      case "starter": {
        adds = `Pupils say what they already think about ${topic} before being told.`;
        if (slot.misconception !== undefined) {
          refs.push({ type: "misconception", index: slot.misconception });
        }
        break;
      }
      case "vocabulary": {
        const terms = slot.terms ?? [];
        refs.push(...terms.map((index): OrdinalRef => ({ type: "vocabulary", index })));
        adds = `Defines the key words: ${terms.map((t) => facts.vocabulary[t]?.term ?? "").join(", ")}.`;
        break;
      }
      case "content": {
        const ks = slot.keyIdeas ?? [];
        const k = ks[0] ?? 0;
        const idea = facts.keyIdeas[k];
        refs.push(...ks.map((index): OrdinalRef => ({ type: "keyIdea", index })));
        const terms = facts.vocabulary
          .flatMap((v, t) => (names(v.objectiveRefs, slot.primary) ? [t] : []))
          .filter((t) => !shownTerms.has(t) && !handedTerms.has(t))
          .slice(0, TERMS_PER_CONTENT);
        for (const t of terms) {
          handedTerms.add(t);
          refs.push({ type: "vocabulary", index: t });
        }
        // Two key ideas: both statements, in order; the facts carry the rest of each.
        adds = `Explains: ${ks.map((j) => facts.keyIdeas[j]?.statement ?? "").join(" Then: ")}`;
        const previous = slots[i - 1];
        if (previous?.kind === "content" && previous.primary === slot.primary) {
          avoids = `Do not repeat: ${(previous.keyIdeas ?? []).map((j) => facts.keyIdeas[j]?.statement ?? "").join(" ")}`;
        }
        const watch = misconceptionsOf(slot.primary).find((m) => !usedMisconceptions.has(m));
        if (watch !== undefined) {
          usedMisconceptions.add(watch);
          callouts[position] = {
            kind: "watch-out",
            ref: { type: "misconception", index: watch },
            text: facts.misconceptions[watch]?.belief ?? "",
          };
        } else if (terms.length > 0) {
          callouts[position] = {
            kind: "key-words",
            ref: { type: "vocabulary", index: terms[0] ?? 0 },
            text: terms.map((t) => facts.vocabulary[t]?.term ?? "").join(", "),
          };
        } else if (idea) {
          callouts[position] = {
            kind: "example",
            ref: { type: "keyIdea", index: k },
            text: idea.example,
          };
        }
        break;
      }
      case "worked-example": {
        const x = slot.workedExample ?? 0;
        const example = facts.workedExamples[x];
        refs.push({ type: "workedExample", index: x });
        const m = example?.misconceptionRef?.index;
        if (m !== undefined) {
          refs.push({ type: "misconception", index: m });
          if (!usedMisconceptions.has(m)) {
            usedMisconceptions.add(m);
            callouts[position] = {
              kind: "watch-out",
              ref: { type: "misconception", index: m },
              text: facts.misconceptions[m]?.belief ?? "",
            };
          }
        }
        adds = `Works through: ${example?.problem ?? ""}`;
        break;
      }
      case "discussion":
      case "multiple-choice":
      case "true-false":
      case "open-response": {
        const q = slot.question === undefined ? undefined : facts.questions[slot.question];
        if (slot.question !== undefined) refs.push({ type: "question", index: slot.question });
        const m = slot.misconception;
        if (m !== undefined) {
          refs.push({ type: "misconception", index: m });
          usedMisconceptions.add(m);
        }
        const belief = m === undefined ? "" : (facts.misconceptions[m]?.belief ?? "");
        const stem = q?.stem ?? "";
        adds =
          slot.kind === "multiple-choice"
            ? `Checks: ${stem}`
            : slot.kind === "true-false"
              ? `Confronts the misconception: ${belief}`
              : slot.kind === "open-response"
                ? `${judges(slot) ? "Pupils judge" : "Pupils explain"}: ${stem}`
                : `Pupils discuss: ${q ? stem : belief}`;
        break;
      }
      case "instructions": {
        const questions = slot.questions ?? [];
        refs.push(...questions.map((index): OrdinalRef => ({ type: "question", index })));
        adds = `Your turn: ${questions.length} questions.`;
        break;
      }
      case "plenary": {
        adds = "Recaps every objective in pupils' own words.";
        break;
      }
      default:
        adds = `${slot.kind} slide.`;
    }
    outline.push({
      kind: slot.kind,
      factRefs: objectiveRefs(slot.objectives),
      phase: slot.phase,
      brief: brief(adds, avoids),
    });
    const callout = callouts[position];
    outlineFactRefs.push({
      index: position,
      factRefs: refs,
      ...(callout
        ? {
            callout: {
              kind: callout.kind,
              refs:
                callout.kind === "key-words"
                  ? refs.filter((r) => r.type === "vocabulary")
                  : [callout.ref],
            },
          }
        : {}),
    });
  });

  // Only fair exit questions: one testing a key idea left off is withheld (gap above).
  const fairExit = facts.questions.flatMap((q, i) => (q.use === "exit" && fair(i) ? [i] : []));
  const withheld = facts.questions.some((q, i) => q.use === "exit" && !fair(i));
  // An exit-ticket item is a stem with no options, so an exit question the facts do not let be
  // asked openly (multiple-choice-native) is replaced: dropped when its objective already has an
  // open exit question, else swapped for an unused fair open question on that objective (slide
  // questions first, then the worksheet's, easiest tier first). Only when none exists does it stay,
  // and the brief says to set it with its options.
  const exitQuestions: number[] = [];
  const withOptions: number[] = [];
  const firstObjectiveOf = (i: number) => refIndices(facts.questions[i]?.objectiveRefs)[0];
  const openExit = fairExit.filter(admitsOpen);
  for (const i of fairExit) {
    if (admitsOpen(i)) {
      exitQuestions.push(i);
      continue;
    }
    const o = firstObjectiveOf(i);
    if (o !== undefined && openExit.some((j) => firstObjectiveOf(j) === o)) continue;
    const swap = facts.questions
      .flatMap((q, j) =>
        q.use !== "exit" &&
        o !== undefined &&
        !used.questions.has(j) &&
        !exitQuestions.includes(j) &&
        names(q.objectiveRefs, o) &&
        admitsOpen(j) &&
        fair(j)
          ? [j]
          : [],
      )
      .sort(
        (a, b) =>
          Number(facts.questions[a]?.use === "worksheet") -
            Number(facts.questions[b]?.use === "worksheet") ||
          tierRank(a) - tierRank(b) ||
          a - b,
      )[0];
    if (swap !== undefined) {
      used.questions.add(swap);
      exitQuestions.push(swap);
    } else {
      exitQuestions.push(i);
      withOptions.push(i);
    }
  }
  const optioned = dedupe(withOptions.map((i) => (firstObjectiveOf(i) ?? 0) + 1));
  const optionsNote =
    optioned.length === 0
      ? ""
      : ` ${EXIT_OPTIONS_NOTE}${optioned.length === 1 ? "" : "s"} ${optioned.join(" and ")}, ${optioned.length === 1 ? "with" : "each with"} its options listed.`;
  outline.push({
    kind: "exit-ticket",
    factRefs: objectiveRefs(all),
    phase: "check",
    brief: brief(
      `${count} question${count === 1 ? "" : "s"}, one per objective${withheld ? ", each on what the slides taught" : ""}.${optionsNote}`,
    ),
  });
  outlineFactRefs.push({
    index: exitPosition,
    factRefs: exitQuestions.map((index): OrdinalRef => ({ type: "question", index })),
  });

  // The shares the fill could not reach are gaps too, so a schema issue always has its sentence.
  const explainSlides = outline.filter(
    (e) => e.phase === "explain" && EXPLAIN_KINDS.has(e.kind),
  ).length;
  const counted = Math.max(0, outline.length - 2);
  const explainShare = slidesFor(shape.explainMinPercent, counted);
  if (explainSlides < explainShare) {
    const why = shareFull.explain
      ? `A ${slideCount}-slide deck has room for ${explainSlides} once every objective is taught.`
      : `The facts allow ${explainSlides}.`;
    gap(`${explainSentence(explainShare, counted)} ${why}`);
  }
  const practiseSlides = outline.filter((e) => e.phase === "practise").length;
  const practiseShare = slidesFor(shape.practiseMinPercent, counted);
  if (practiseSlides < practiseShare) {
    // Ruling 81: practice is what a short deck gives up, never an objective's teaching slide.
    const why = shareFull.practise
      ? `A ${slideCount}-slide deck has room for ${practiseSlides} once every objective is taught.`
      : `The facts' slide and worksheet questions allow ${practiseSlides}.`;
    gap(`${practiseSentence(practiseShare, counted)} ${why}`);
  }

  const coverage: ObjectiveCoverage[] = all.map((o) => ({
    taught: slots.flatMap((s, i) =>
      (s.kind === "content" || s.kind === "worked-example") &&
      s.phase === "explain" &&
      s.objectives.includes(o)
        ? [i + 2]
        : [],
    ),
    practised: slots.flatMap((s, i) =>
      s.phase === "practise" && s.objectives.includes(o) ? [i + 2] : [],
    ),
    checked: exitQuestions.some((i) => names(facts.questions[i]?.objectiveRefs, o))
      ? [exitPosition]
      : [],
  }));

  const unplaced = {
    keyIdeas: facts.keyIdeas.flatMap((_, i) => (used.keyIdeas.has(i) ? [] : [i])),
    workedExamples: facts.workedExamples.flatMap((_, i) => (used.workedExamples.has(i) ? [] : [i])),
    questions: facts.questions.flatMap((q, i) =>
      q.use === "worksheet" || used.questions.has(i) || q.use === "exit" ? [] : [i],
    ),
  };

  return {
    skeleton: { learningObjectives: input.objectives.map((o) => ({ text: o.text })), outline },
    outlineFactRefs,
    callouts,
    coverage,
    unplaced,
    gaps,
  };
}

function compareRanks(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** One sentence at most `BRIEF_MAX` characters, cut at a word boundary with an ellipsis. */
export function clip(text: string, max = BRIEF_MAX): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  const head = trimmed.slice(0, max - 1);
  const cut = head.lastIndexOf(" ");
  const kept = (cut > max / 2 ? head.slice(0, cut) : head).replace(/[\s,;:.]+$/, "");
  return `${kept}…`;
}

/** The same brief twice would say two slides add the same thing: number the repeat. */
function distinctBrief(adds: string, seen: Set<string>): string {
  let candidate = adds;
  for (let n = 2; seen.has(candidate); n++) {
    const suffix = ` (${n})`;
    candidate = `${clip(adds, BRIEF_MAX - suffix.length)}${suffix}`;
  }
  seen.add(candidate);
  return candidate;
}

function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
