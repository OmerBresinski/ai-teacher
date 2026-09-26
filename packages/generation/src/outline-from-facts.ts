import type {
  CalloutKind,
  GeneratableSlideKind,
  LessonPhase,
  SlideCount,
} from "@tj/domain/documents";
import { QUESTION_TIERS } from "@tj/domain/documents";
import type { QuestionDemand, QuestionForm } from "./merge-objective-facts";
import {
  EXIT_CHARS,
  EXIT_QUIZ_MAX,
  EXIT_QUIZ_MIN,
  fitsLine,
  keptLines,
  type Line,
  misconceptionLine,
  questionLine,
  SET_MAX,
  SET_MIN,
  STARTER_MAX,
  sameQuestion,
} from "./planner/coded-slides";
import { explainSentence, practiseSentence, slidesFor } from "./prompts/shape";
import type { LessonShape } from "./shapes";
import {
  askableAsStem,
  distractorsEchoingAnswer,
  EXPLAIN_KINDS,
  type OrdinalRef,
  type PlanFactsLike,
  type PlanSkeleton,
} from "./specs";

/*
 * The outline, built in code from the merged per-objective facts (ADR 0025 §7: the skeleton the
 * facts fill; ADR 0029 item 9: the brief's slide count is exact). Plan used to ask a model for the
 * outline before any fact existed (`plan-skeleton`) and only then for the facts, so the outline
 * promised slides the facts could not always supply. Now the objectives call runs first, one facts
 * call per objective follows (`mergeObjectiveFacts`), and this module decides which fact goes on
 * which slide: one content slide per objective first, then the starter, then what the lesson's
 * shape (`shapes.ts`) requires, then practice per objective and whatever else the facts hold,
 * until the slide count is spent. The result is the same `PlanSkeleton` + `outlineFactRefs` pair
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
 *
 * Lesson flow (w0b, 24 Sep: the lab plan lost practice 2.44 v 3.19 and flow 2.25 v 3.25 to
 * production; "no starter" and "thin practice" in 6 of 8 pairs). Which slides exist is still the
 * fill above; the running order and three priorities changed:
 * - A starter opens the lesson (it used to be placed after all practice and rarely fitted a
 *   ten-slide deck). It retrieves the prior knowledge the brief declares (`priorKnowledge`, the
 *   class context), and then outranks the shared practise slide's second objective (ruling 81
 *   below keeps the starter's slot). Without declared prior knowledge it asks what pupils already
 *   think, on the first misconception, a gap says why, and it takes a slot only once every
 *   objective is taught and practised, the shape's kinds and floors are met and the remaining
 *   worked examples are placed. It carries no question: it tests nothing this lesson teaches.
 * - Learning cycles, not all practice at the end: the teaching slides run objective by objective,
 *   at most two content slides a cycle with the objective's worked example after them, and each
 *   practise slide sits straight after the cycle that makes it fair — the earliest cycle by which
 *   every key idea it declares (`keyIdeaRefs`; else every key idea of each objective it names) is
 *   on a slide; an `apply` question also waits for its objective's worked example. A judgement
 *   the facts declared on the last objective closes the practise slides; plenary and exit ticket close the lesson. The
 *   skeleton passes `planSkeletonSchemaFor` with `learningCycles`.
 * - Model, then practise: an objective whose questions declare an `apply` demand gets its worked
 *   example placed before the shape's kinds and floors take the budget, and so before its practice.
 *   An objective with apply questions and no worked example is a gap: the facts must supply one.
 * - The exit ticket is short: 3–5 items (`EXIT_MIN`, `EXIT_MAX`), one per objective first; a
 *   ticket the exit questions leave under three is topped up with unused fair questions that can
 *   be asked as a line of it.
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
  /** The brief's class-context prior knowledge, when the teacher gave it: what the starter retrieves. */
  priorKnowledge?: string | undefined;
  /**
   * Lab r2: the objectives call's retrieval questions (prior knowledge from earlier lessons). When
   * present the starter is their set, printed in code from `LessonFacts.retrieval`, and takes no
   * question of this lesson's facts, which stay for the checks and the exit quiz. Absent (older
   * runs, replays): the round-1 starter.
   */
  retrieval?: readonly { question: string; answer: string }[] | undefined;
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
  /** The learning cycles in running order: outline positions of the teaching slides, then of the checks after them. */
  cycles: { teach: number[]; check: number[] }[];
};

/** The brief's `adds` / `avoids` cap (`SPEC_LIMITS.item`), restated so this module has no `@tj/slides` import. */
const BRIEF_MAX = 160;
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
const SHARED_PRACTISE_MAX = SET_MAX;
/** The questions a cycle's check set asks (r1: "a check of 2–3 after each cycle"); P8 may take it to `SET_MAX`. */
const CHECK_SET = 3;
/** Content slides one learning cycle teaches before its check: a slide, or a pair. */
const CONTENT_PER_CYCLE = 2;
/** The exit ticket's length: a short quiz, not three extended answers (uk-teacher review, w0b judges). */
export const EXIT_MIN = EXIT_QUIZ_MIN;
export const EXIT_MAX = EXIT_QUIZ_MAX;

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
  /** A starter that prints the retrieval set (lab r2): no question or misconception of the lesson's. */
  retrieval?: boolean;
  terms?: number[];
  /** A judgement the facts declared on the last objective: it closes the practise slides, after every cycle. */
  closing?: boolean;
  /** Lexicographic running-order key: phase, objective, then the fact order. */
  rank: number[];
};

export function outlineFromFacts(input: OutlineFromFactsInput): OutlineFromFactsResult {
  const { facts, shape, slideCount, topic } = input;
  const count = input.objectives.length;
  const all = Array.from({ length: count }, (_, i) => i);
  const priorKnowledge = input.priorKnowledge?.trim() ?? "";
  const retrieves = (input.retrieval?.length ?? 0) > 0;
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
  /**
   * Question `i` may go on a step that prints its stem only (the shared practise slide, an
   * open-response or discussion slide, the exit ticket): `askableAsStem` — declared (or natively)
   * open, with fewer than three distractors and no declared true-false form. Three distractors
   * make multiple choice its form everywhere downstream (`LessonFacts` keeps no `forms`), and a
   * true-false statement is not a question on its own; either shown as a bare stem is a question
   * without its options (w0: 12 option-less stems on 8 lab decks, two exit tickets failing
   * `checkLesson`).
   */
  const admitsOpen = (i: number) => {
    const q = facts.questions[i];
    return q !== undefined && askableAsStem(q);
  };
  const tfUsable = (i: number) =>
    formsOf(i).includes("true-false") && !shape.forbiddenKinds.includes("true-false");
  /** Multiple choice with three distractors, none repeating the answer (the slide would show it twice). */
  const mcUsable = (i: number) => {
    const q = facts.questions[i];
    return (
      q !== undefined &&
      formsOf(i).includes("multiple-choice") &&
      (q.distractors?.length ?? 0) >= 3 &&
      distractorsEchoingAnswer(q).length === 0
    );
  };
  /**
   * Question `i` has a form a practise slide can show with everything it needs: asked as a stem
   * (`admitsOpen`), true/false with its misconception, or multiple choice with the three
   * distractors a four-option slide needs. Anything else would reach a slide as a stem without
   * its options, so it is not placed.
   */
  const showable = (i: number) => admitsOpen(i) || tfUsable(i) || mcUsable(i);
  /** A practise slide from question `i` in one of its declared forms (`open` asks for open-response). */
  const questionSlot = (o: number, i: number, open = false): Slot => {
    const q = facts.questions[i];
    const distractors = q?.distractors ?? [];
    const tagged = distractors.find((d) => d.misconceptionRef !== undefined);
    let kind: Kind;
    let misconception: number | undefined;
    if (open && admitsOpen(i)) {
      kind = "open-response";
    } else if (
      shape.requireMisconceptionConfronted &&
      !has("true-false") &&
      tfUsable(i) &&
      tagged
    ) {
      kind = "true-false";
      misconception = tagged.misconceptionRef?.index;
    } else if (mcUsable(i)) {
      kind = "multiple-choice";
    } else if (admitsOpen(i)) {
      kind = shape.forbiddenKinds.includes("open-response") ? "discussion" : "open-response";
    } else if (tfUsable(i) && tagged) {
      // Declared true-false only: the slide that prints the statement with its true/false options.
      kind = "true-false";
      misconception = tagged.misconceptionRef?.index;
    } else {
      // Not reached: callers place only `showable` questions.
      kind = "open-response";
    }
    const seq = slots.length;
    // A question the facts call declared a judgement closes the practise phase when it serves the
    // last objective; an earlier objective's judgement stays in its own cycle as that objective's
    // check (l6j: closing it moved o1's only check after the last cycle in 20 of 91 decks).
    const last =
      kind === "open-response" &&
      q?.demand === "judgement" &&
      (o === count - 1 || refIndices(q?.objectiveRefs).includes(count - 1));
    return {
      kind,
      phase: "practise",
      primary: o,
      objectives: refIndices(q?.objectiveRefs),
      question: i,
      ...(misconception === undefined ? {} : { misconception }),
      ...(last ? { closing: true } : {}),
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
  /**
   * Question `i` can be one line of a question set (r1, ruling 89 pending): asked as a stem, or
   * multiple choice with its four options on the line, and the line fits a list item. The form is
   * the one a single slide would show; nothing is inferred.
   */
  const settable = (i: number) => {
    const q = facts.questions[i];
    return q !== undefined && (admitsOpen(i) || mcUsable(i)) && fitsLine(questionLine(q));
  };
  /**
   * A check set on objective `o`: unused fair settable questions that name it, slide questions
   * before the worksheet's, easiest tier first; never an exit question.
   */
  const setFor = (o: number, max: number) =>
    shape.forbiddenKinds.includes("instructions") ? [] : withinSet(setCandidates(o), max);
  /** Candidates in order, kept while the set's text fits one slide (`keptLines`). */
  const withinSet = (candidates: number[], max: number) => {
    const lines = candidates.map((i) => ({
      i,
      ...questionLine(facts.questions[i] ?? { stem: "", answer: "" }),
    }));
    return keptLines(lines, max).map((l) => l.i);
  };
  const setCandidates = (o: number) =>
    facts.questions
      .flatMap((q, i) =>
        q.use !== "exit" &&
        !used.questions.has(i) &&
        names(q.objectiveRefs, o) &&
        settable(i) &&
        fair(i)
          ? [i]
          : [],
      )
      .sort(
        (a, b) =>
          Number(facts.questions[a]?.use === "worksheet") -
            Number(facts.questions[b]?.use === "worksheet") ||
          tierRank(a) - tierRank(b) ||
          a - b,
      );
  const setSlot = (o: number, questions: number[]): Slot => ({
    kind: "instructions",
    phase: "practise",
    primary: o,
    objectives: dedupe(
      questions.flatMap((i) => refIndices(facts.questions[i]?.objectiveRefs)),
    ).sort((a, b) => a - b),
    questions,
    rank: [2, o, slots.length],
  });
  /**
   * The check on objective `o`: a set of 2–3 questions when the facts have them, else a slide of
   * the one question that fits; `undefined` when none is fair.
   */
  const checkSlot = (o: number): Slot | undefined => {
    // A shape that confronts a misconception keeps its one true/false slide.
    if (shape.requireMisconceptionConfronted && !has("true-false")) {
      const tf = questionsOf(o).find(
        (i) =>
          !used.questions.has(i) &&
          tfUsable(i) &&
          fair(i) &&
          questionSlot(o, i).kind === "true-false",
      );
      if (tf !== undefined) return questionSlot(o, tf);
    }
    const set = setFor(o, CHECK_SET);
    if (set.length >= SET_MIN) return setSlot(o, set);
    const i = firstUnusedQuestion(o);
    return i === undefined ? undefined : questionSlot(o, i);
  };
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

  /**
   * r1 (structure): the slots kept while teaching, the kinds and the extras are placed — the
   * starter's (it opens every lesson) and a check for each objective but the last that has a
   * question to ask (the exit quiz follows the last cycle, so its check is kept only when there is
   * room). Never fewer than the one practise slot `practiseReserve` keeps.
   */
  const reserve = (anyQuestion = false) => {
    const starter = count > 0 && !has("starter") ? 1 : 0;
    const checks = all.slice(0, -1).filter(
      (o) =>
        !practised(o) &&
        // Only a check that can be fair is kept: an objective whose key ideas are still being
        // placed (its questions untested yet) lets teaching go on until one is.
        facts.questions.some(
          (q, i) =>
            q.use !== "exit" &&
            isSlideQuestion(q) &&
            names(q.objectiveRefs, o) &&
            !used.questions.has(i) &&
            fair(i),
        ),
    ).length;
    return starter + Math.max(checks, practiseReserve(anyQuestion));
  };

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
    budget > reserve(true) && next !== undefined;
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

  // P1c: model, then practise (w0b trig: a side calculation tested and never modelled). An
  // objective whose questions the facts call declared `apply` gets its worked example now, before
  // the shape's kinds and floors spend the budget; the running order puts it before the
  // objective's practice. No worked example for it is a gap for the facts call to close.
  for (const o of all) {
    const applies = facts.questions.some((q) => q.demand === "apply" && names(q.objectiveRefs, o));
    if (!applies) continue;
    const own = ownedWorkedExamples.filter((x) => ownersOf[x]?.includes(o));
    if (own.length === 0) {
      gap(
        `${nth(o)}'s questions ask pupils to apply it and the facts have no worked example for it, so no slide models it before they practise.`,
      );
      continue;
    }
    if (own.some((x) => used.workedExamples.has(x))) continue;
    const x = pickWorkedExample(own);
    if (x === undefined || budget <= reserve() || !place(workedExampleSlot(o, x))) {
      gap(
        `${nth(o)}'s questions ask pupils to apply it and a ${slideCount}-slide deck has no room for its worked example.`,
      );
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
        budget <= reserve() ||
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
        budget > reserve() &&
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
          (j) => !used.questions.has(j) && !taken.has(j) && short(j) && settable(j) && fair(j),
        ) ??
        facts.questions
          .flatMap((q, j) =>
            q.use === "worksheet" &&
            !used.questions.has(j) &&
            !taken.has(j) &&
            names(q.objectiveRefs, o) &&
            short(j) &&
            settable(j) &&
            fair(j)
              ? [j]
              : [],
          )
          .sort((a, b) => tierRank(a) - tierRank(b) || a - b)[0];
      if (i === undefined) return [];
      taken.add(i);
      return [[o, i]];
    });
    // A retrieval starter's slot is kept while there is none (w0b flow): with prior knowledge
    // declared, retrieving it outranks a slide of practice; without, the practice comes first and
    // the starter takes what is left.
    const room = budget - (count > 0 && !has("starter") ? 1 : 0);
    // r1: the last objective's check may be the exit quiz that follows its cycle, so a deck with a
    // slot for every other objective's check gives each its own rather than sharing one.
    const own = pending.filter(([o]) => o < count - 1).length;
    if (pending.length < 2 || room >= pending.length || room >= own || room <= 0) return;
    // Learning cycles (w0b): the slots beyond the shared one give the first objectives a check of
    // their own, straight after their cycle; the shared slide takes the rest (two or more). The
    // spare slots used to go to splitting a paired content slide.
    let spare = room - 1;
    while (spare > 0 && pending.length > 2) {
      const [o, i] = pending.shift() ?? [];
      if (o === undefined || i === undefined) break;
      place(checkSlot(o) ?? questionSlot(o, i));
      spare -= 1;
    }
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
  /** The open-response slide the shape requires: P8 never turns it into a practice set. */
  let requiredOpen: Slot | undefined;
  if (required.has("open-response") && !has("open-response")) {
    if (!needOpen) noMaterial("open-response", "question that can be asked openly");
    else if (budget <= 0) noRoom("open-response");
    else {
      // A question the facts declared askable openly (`forms`), or wrote without distractors.
      // One declared a judgement first, then any, each searched from the last objective back, so
      // a judgement that closes the lesson is preferred over an early one that checks its own
      // cycle. The order is a structural preference, the form is never inferred from the content.
      let slot: Slot | undefined;
      const open = (o: number) =>
        questionsOf(o).filter((i) => !used.questions.has(i) && admitsOpen(i) && fair(i));
      const judged = [...all]
        .reverse()
        .flatMap((o) =>
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
      // r1: it never takes a slot kept for the starter or a cycle check, unless it is that check.
      const checks = (x: Slot) =>
        x.objectives.some((o) => o < count - 1 && !practised(o)) ? 1 : 0;
      if (slot === undefined) noMaterial("open-response", "question left to ask openly");
      else if (budget <= reserve() - checks(slot) || !place(slot)) noRoom("open-response");
      else requiredOpen = slot;
    }
  }
  placeSharedPractise();

  // The starter (w0b flow), never in the slot kept for practice. It asks before teaching by
  // design, so it carries no question and tests nothing this lesson teaches. A retrieval starter
  // (prior knowledge declared) comes here, P2b: after the shape's required kinds and the shared
  // practise slide, which kept its slot, and before the floors. Without declared prior knowledge
  // it waits until every objective is practised, the floors are met and the remaining worked
  // examples are placed (P5).
  const placeStarter = () => {
    if (count === 0) return;
    const placed =
      budget > practiseReserve() &&
      place({
        kind: "starter",
        phase: "starter",
        primary: 0,
        objectives: [0],
        ...(retrieves
          ? { retrieval: true }
          : priorKnowledge === "" && facts.misconceptions.length > 0
            ? { misconception: 0 }
            : {}),
        rank: [0],
      });
    if (!placed)
      gap(
        `A ${slideCount}-slide deck has no room for a starter once every objective is taught and practised.`,
      );
    else if (priorKnowledge === "" && !retrieves) {
      gap(
        `The brief declares no prior knowledge, so the starter asks what pupils already think about ${topic} instead of retrieving an earlier idea.`,
      );
    }
  };
  // r1: the starter's slot comes before every optional slide. With prior knowledge declared it
  // retrieves it (the model writes it from the brief); without, it is a quick retrieval set of the
  // lesson's easiest questions, one per objective, before the cycle checks take theirs; with fewer
  // than two such questions, it asks what pupils already think (as before). r2: with a retrieval
  // set it is that set, in the same slot, and none of the lesson's questions.
  if (!has("starter") && retrieves && priorKnowledge === "" && count > 0 && budget > 0) {
    place({
      kind: "starter",
      phase: "starter",
      primary: 0,
      objectives: [0],
      retrieval: true,
      rank: [0],
    });
  }
  if (!has("starter") && !retrieves && priorKnowledge === "" && count > 0 && budget > 0) {
    const easiest = all
      .flatMap((o) => {
        const i = facts.questions
          .flatMap((q, j) =>
            q.use !== "exit" && !used.questions.has(j) && names(q.objectiveRefs, o) && settable(j)
              ? [j]
              : [],
          )
          .sort((a, b) => tierRank(a) - tierRank(b) || a - b)[0];
        return i === undefined ? [] : [i];
      })
      .sort((a, b) => tierRank(a) - tierRank(b) || a - b)
      .slice(0, STARTER_MAX);
    // The starter takes a question only where its objective keeps a set's worth (two) for its
    // check: a cycle check of two outranks one more starter item.
    const spareFor = (i: number) =>
      refIndices(facts.questions[i]?.objectiveRefs).every(
        (o) =>
          facts.questions.filter(
            (q, j) =>
              j !== i &&
              q.use !== "exit" &&
              names(q.objectiveRefs, o) &&
              !used.questions.has(j) &&
              showable(j),
          ).length >= SET_MIN,
      );
    const picked = easiest.filter(spareFor).sort((a, b) => a - b);
    if (picked.length >= SET_MIN) {
      place({
        kind: "starter",
        phase: "starter",
        primary: 0,
        objectives: dedupe(picked.flatMap((i) => refIndices(facts.questions[i]?.objectiveRefs))),
        questions: picked,
        rank: [0],
      });
    }
  }
  if (!has("starter")) placeStarter();

  // r1: a check after each learning cycle, before the floors and extras: every objective in order,
  // a set of 2–3 questions where the facts have them (the running order puts each after its cycle).
  for (const o of all) {
    if (practised(o) || budget <= 0) continue;
    const slot = checkSlot(o);
    if (slot !== undefined) place(slot);
  }

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
    const slot = o === undefined ? undefined : checkSlot(o);
    if (slot === undefined) {
      gap(
        `The shape needs ${shape.minCheckEntries} slides where pupils answer and the facts have questions for ${practiseCount() + 1}.`,
      );
      break;
    }
    if (!place(slot)) {
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
    const slot = o === undefined ? undefined : checkSlot(o);
    if (slot !== undefined) {
      if (!place(slot)) {
        shareFull.practise = true;
        break;
      }
      continue;
    }
    let i: number | undefined;
    let owner: number | undefined;
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
    const slot = checkSlot(o);
    if (slot !== undefined) place(slot);
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

  // P8: a practice set. The facts carry three to six questions per objective (v14) and a 10-slide deck
  // gave about three of them a slide each (np1 -ff: 48 of 223 on practise slides); the worksheet
  // that took the rest is its own optional job (ADR 0030). An `instructions` slide holds up to four
  // short stems (ruling 81), so the unused slide and worksheet questions fill one, without a slot of
  // their own: the shared slide when there is one, else the last single-question multiple-choice or
  // open-response slide the shape can spare becomes a set around its question. Exit questions stay
  // for the exit ticket, and a set step is a stem with no options, so only a question the facts
  // declared askable openly joins one. Unpractised objectives first, then the harder tiers (the single-question
  // slides took the easiest); the set is asked easiest first.
  // r1 exit quiz, chosen before P8 tops the sets up: 4–6 quick items (multiple choice with its
  // options, a one-line answer, or true/false on a misconception), printed from the facts in code
  // with the answers revealed on the slide — no model writes or pads it. The facts' fair exit
  // questions first, one per objective before any objective's second; under four, unused fair
  // slide and worksheet questions (never a declared judgement), then true/false lines on the
  // misconceptions of taught objectives, the objectives with the fewest items first.
  const firstObjectiveOf = (i: number) => refIndices(facts.questions[i]?.objectiveRefs)[0];
  type ExitItem = { type: "question" | "misconception"; index: number; line: Line };
  const exitItems: ExitItem[] = [];
  const itemObjectives = (it: ExitItem) =>
    refIndices(
      it.type === "question"
        ? facts.questions[it.index]?.objectiveRefs
        : facts.misconceptions[it.index]?.objectiveRefs,
    );
  /** Two question items ask the same thing (`sameQuestion`); a misconception line never repeats. */
  const repeats = (a: ExitItem, b: ExitItem) => {
    const x = a.type === "question" ? facts.questions[a.index] : undefined;
    const y = b.type === "question" ? facts.questions[b.index] : undefined;
    return x !== undefined && y !== undefined && sameQuestion(x, y);
  };
  const questionItem = (i: number): ExitItem => ({
    type: "question",
    index: i,
    line: questionLine(facts.questions[i] ?? { stem: "", answer: "" }),
  });
  {
    const exits = facts.questions.flatMap((q, i) =>
      q.use === "exit" && !used.questions.has(i) && fair(i) ? [i] : [],
    );
    for (const i of exits) {
      if (settable(i)) continue;
      gap(
        `Exit question ${i + 1} cannot be a line of the exit quiz (no form a line can show, or too long), so it is left off.`,
      );
    }
    const round = new Map<number, number>();
    const ranked = exits
      .filter(settable)
      .map((i, at) => {
        const o = firstObjectiveOf(i) ?? count;
        const n = round.get(o) ?? 0;
        round.set(o, n + 1);
        return { i, at, n };
      })
      .sort((a, b) => a.n - b.n || a.at - b.at)
      .map((r) => questionItem(r.i))
      // pw: a later exit question that asks what an earlier one asks stays off the quiz.
      .filter((it, at, all) => !all.slice(0, at).some((prior) => repeats(prior, it)));
    const kept = keptLines(
      ranked.map((it) => ({ ...it.line, it })),
      EXIT_QUIZ_MAX,
      EXIT_CHARS,
    ).map((l) => l.it);
    exitItems.push(...kept);
    const over = ranked.filter((it) => !kept.includes(it));
    if (over.length > 0) {
      gap(
        `The exit quiz holds ${EXIT_QUIZ_MAX} items, so exit question${over.length === 1 ? "" : "s"} ${over.map((it) => it.index + 1).join(", ")} ${over.length === 1 ? "is" : "are"} left off it.`,
      );
    }
    const itemsOn = (o: number) => exitItems.filter((it) => itemObjectives(it).includes(o)).length;
    const fewest = (objectives: number[]) => Math.min(...objectives.map(itemsOn));
    const chars = () => exitItems.reduce((n, it) => n + it.line.text.length, 0);
    const topUp = (candidates: ExitItem[]) => {
      const sorted = candidates.sort(
        (a, b) =>
          fewest(itemObjectives(a)) - fewest(itemObjectives(b)) ||
          (a.type === "question" ? tierRank(a.index) : 0) -
            (b.type === "question" ? tierRank(b.index) : 0) ||
          a.index - b.index,
      );
      for (const it of sorted) {
        if (exitItems.length >= EXIT_QUIZ_MIN) return;
        if (!fitsLine(it.line) || chars() + it.line.text.length > EXIT_CHARS) continue;
        if (exitItems.some((on) => repeats(on, it))) continue;
        exitItems.push(it);
      }
    };
    topUp(
      facts.questions.flatMap((q, i) =>
        q.use !== "exit" &&
        !used.questions.has(i) &&
        q.demand !== "judgement" &&
        settable(i) &&
        fair(i)
          ? [questionItem(i)]
          : [],
      ),
    );
    const onSlide = new Set(
      slots.flatMap((x) =>
        x.kind === "true-false" && x.misconception !== undefined ? [x.misconception] : [],
      ),
    );
    topUp(
      facts.misconceptions.flatMap((m, i) =>
        !onSlide.has(i) &&
        m.objectiveRefs.length > 0 &&
        refIndices(m.objectiveRefs).every((o) => taught(o))
          ? [{ type: "misconception" as const, index: i, line: misconceptionLine(m) }]
          : [],
      ),
    );
    if (exitItems.length < EXIT_QUIZ_MIN) {
      gap(
        `The exit quiz has ${exitItems.length} item${exitItems.length === 1 ? "" : "s"}: the facts have no other question or misconception that can be a line of it.`,
      );
    }
    for (const it of exitItems) if (it.type === "question") used.questions.add(it.index);
    exitItems.sort(
      (a, b) =>
        Math.min(...itemObjectives(a), count) - Math.min(...itemObjectives(b), count) ||
        Number(a.type === "misconception") - Number(b.type === "misconception") ||
        a.index - b.index,
    );
  }
  const setPool = () =>
    facts.questions
      .flatMap((q, i) =>
        q.use !== "exit" && !used.questions.has(i) && settable(i) && fair(i) ? [i] : [],
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
    s !== requiredOpen &&
    s.phase === "practise" &&
    s.question !== undefined &&
    (s.kind === "multiple-choice" || s.kind === "open-response") &&
    facts.questions[s.question]?.demand !== "judgement" &&
    settable(s.question) &&
    (!required.has(s.kind) || countOf(s.kind) > 1);
  const pool = shape.forbiddenKinds.includes("instructions") ? [] : setPool();
  /** Asked easiest first, then by objective. */
  const setOrder = (a: number, b: number) =>
    tierRank(a) - tierRank(b) || firstObjective(a) - firstObjective(b) || a - b;
  const sets = slots.filter((s) => s.kind === "instructions" && s.phase === "practise");
  if (sets.length > 0) {
    // r1: every set (a cycle's check, or ruling 81's shared slide) is topped up to `SET_MAX` with
    // the pool's questions on objectives it already asks about, so its place in the running order
    // (after the cycle that makes it fair) does not move. Within the set's character budget
    // (`withinSet`, the lines it already holds counted): the coded slide keeps only what fits
    // `SET_CHARS`, so a question topped up past it was marked used and never shown (pw, Sept 2026:
    // the demand fill read four 240-character lines to a set that prints two).
    for (const set of sets) {
      const within = pool.filter(
        (i) =>
          !used.questions.has(i) &&
          refIndices(facts.questions[i]?.objectiveRefs).every((o) => set.objectives.includes(o)),
      );
      const questions = withinSet([...(set.questions ?? []), ...within], SET_MAX).sort(setOrder);
      for (const i of questions) used.questions.add(i);
      set.questions = questions;
    }
  } else {
    const set =
      pool.length >= 2
        ? slots
            .filter(spare)
            .sort(
              (a, b) =>
                Number(a.kind !== "multiple-choice") - Number(b.kind !== "multiple-choice") ||
                compareRanks(b.rank, a.rank),
            )[0]
        : undefined;
    if (set && pool.length > 0) {
      const questions = withinSet(
        [...(set.question === undefined ? [] : [set.question]), ...pool],
        SET_MAX,
      ).sort(setOrder);
      for (const i of questions) used.questions.add(i);
      set.kind = "instructions";
      delete set.question;
      set.questions = questions;
      set.objectives = dedupe(
        questions.flatMap((i) => refIndices(facts.questions[i]?.objectiveRefs)),
      ).sort((a, b) => a - b);
    }
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

  /**
   * Learning cycles (w0b flow): the starter and the vocabulary slide open; then, objective by
   * objective, up to `CONTENT_PER_CYCLE` content slides and (after the objective's last content
   * slide) the worked examples whose last owner it is, each cycle followed by the practise slides
   * it makes fair; then the practise slides a declared judgement closes; then the plenary. Sorts
   * `slots` in place and returns the cycles as slot lists.
   */
  function orderInCycles(): { teach: Slot[]; check: Slot[] }[] {
    const byRank = (a: Slot, b: Slot) => compareRanks(a.rank, b.rank);
    const lastOwner = (s: Slot) => Math.max(s.primary, ...s.objectives);
    const cycles: { teach: Slot[]; check: Slot[] }[] = [];
    for (const o of all) {
      const contents = slots.filter((s) => s.kind === "content" && s.primary === o).sort(byRank);
      const examples = slots
        .filter((s) => s.kind === "worked-example" && lastOwner(s) === o)
        .sort(byRank);
      for (let c = 0; c < contents.length; c += CONTENT_PER_CYCLE) {
        cycles.push({ teach: contents.slice(c, c + CONTENT_PER_CYCLE), check: [] });
      }
      const last = cycles.at(-1);
      if (examples.length === 0) continue;
      if (contents.length > 0 && last) last.teach.push(...examples);
      else cycles.push({ teach: examples, check: [] });
    }
    const cycleOf = new Map<Slot, number>();
    cycles.forEach((c, i) => {
      for (const s of c.teach) cycleOf.set(s, i);
    });
    const keyIdeaCycle = new Map<number, number>();
    const objectiveEnd = new Map<number, number>();
    const exampleCycle = new Map<number, number>();
    cycles.forEach((c, i) => {
      for (const s of c.teach) {
        for (const k of s.keyIdeas ?? []) if (!keyIdeaCycle.has(k)) keyIdeaCycle.set(k, i);
        for (const o of [s.primary, ...s.objectives]) objectiveEnd.set(o, i);
        if (s.kind === "worked-example") for (const o of s.objectives) exampleCycle.set(o, i);
      }
    });
    const lastCycle = cycles.length - 1;
    /** The earliest cycle after which practise slide `s` is fair; `lastCycle + 1` closes. */
    const checkCycle = (s: Slot): number => {
      if (s.closing) return lastCycle + 1;
      const asked = s.questions ?? (s.question === undefined ? [] : [s.question]);
      let at = -1;
      for (const i of asked) {
        const declared = testedKeyIdeas(i);
        const named = refIndices(facts.questions[i]?.objectiveRefs);
        const tested = declared.length > 0 ? declared : named.flatMap(keyIdeasOf);
        for (const k of tested) at = Math.max(at, keyIdeaCycle.get(k) ?? lastCycle);
        if (tested.length === 0)
          for (const o of named) at = Math.max(at, objectiveEnd.get(o) ?? -1);
      }
      // A discussion confronts its objective's misconception: after that objective is taught.
      if (asked.length === 0)
        for (const o of s.objectives) at = Math.max(at, objectiveEnd.get(o) ?? -1);
      // Model, then practise: a question the facts declared `apply` never comes before a worked
      // example of an objective it names. (Without `keyIdeaRefs` a question already follows its
      // objective's whole cycle, the worked example included.)
      for (const i of asked) {
        if (facts.questions[i]?.demand !== "apply") continue;
        for (const o of refIndices(facts.questions[i]?.objectiveRefs)) {
          at = Math.max(at, exampleCycle.get(o) ?? -1);
        }
      }
      return at < 0 ? lastCycle : at;
    };
    const closing: Slot[] = [];
    for (const s of slots.filter((x) => x.phase === "practise").sort(byRank)) {
      const at = checkCycle(s);
      const cycle = cycles[at];
      if (cycle === undefined) closing.push(s);
      else cycle.check.push(s);
    }
    const placedInCycles = new Set([
      ...cycles.flatMap((c) => [...c.teach, ...c.check]),
      ...closing,
    ]);
    const opening = slots
      .filter((s) => !placedInCycles.has(s) && (s.phase === "starter" || s.kind === "vocabulary"))
      .sort(byRank);
    const rest = slots.filter((s) => !placedInCycles.has(s) && !opening.includes(s)).sort(byRank);
    const ordered = [
      ...opening,
      ...cycles.flatMap((c) => [...c.teach, ...c.check]),
      ...closing,
      ...rest,
    ];
    slots.splice(0, slots.length, ...ordered);
    return cycles;
  }

  const cycleSlots = orderInCycles();
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
        const asked = slot.questions ?? [];
        refs.push(...asked.map((index): OrdinalRef => ({ type: "question", index })));
        adds = slot.retrieval
          ? `Retrieval: ${input.retrieval?.length ?? 0} quick questions on earlier lessons pupils answer from memory before the teaching.`
          : asked.length > 0
            ? `Retrieval: ${asked.length} quick questions pupils answer from memory before the teaching.`
            : priorKnowledge === ""
              ? `Pupils say what they already think about ${topic} before being told.`
              : `Retrieval: pupils recall what the class has already covered: ${priorKnowledge}`;
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

  // The exit quiz (chosen above): its items as refs, in objective order.
  const withheld = facts.questions.some((q, i) => q.use === "exit" && !fair(i));
  const n = exitItems.length;
  outline.push({
    kind: "exit-ticket",
    factRefs: objectiveRefs(all),
    phase: "check",
    brief: brief(
      `${n} quick item${n === 1 ? "" : "s"} across the objectives${withheld ? ", each on what the slides taught" : ""}; the answers are revealed on the slide.`,
    ),
  });
  outlineFactRefs.push({
    index: exitPosition,
    factRefs: exitItems.map((it): OrdinalRef => ({ type: it.type, index: it.index })),
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
    checked: exitItems.some((it) => itemObjectives(it).includes(o)) ? [exitPosition] : [],
  }));

  const unplaced = {
    keyIdeas: facts.keyIdeas.flatMap((_, i) => (used.keyIdeas.has(i) ? [] : [i])),
    workedExamples: facts.workedExamples.flatMap((_, i) => (used.workedExamples.has(i) ? [] : [i])),
    questions: facts.questions.flatMap((q, i) =>
      q.use === "worksheet" || used.questions.has(i) || q.use === "exit" ? [] : [i],
    ),
  };

  const positionOf = (slot: Slot) => slots.indexOf(slot) + 2;
  const cycles = cycleSlots.map((c) => ({
    teach: c.teach.map(positionOf),
    check: c.check.map(positionOf),
  }));

  return {
    skeleton: { learningObjectives: input.objectives.map((o) => ({ text: o.text })), outline },
    outlineFactRefs,
    callouts,
    coverage,
    unplaced,
    gaps,
    cycles,
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
