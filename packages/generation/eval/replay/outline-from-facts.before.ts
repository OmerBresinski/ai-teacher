// The outline step as it was before the RC1 fix (np1 root cause, 23 Sep): the OLD side of `eval/replay-outline.ts`. Frozen; do not edit.
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
 */

/** A question as the outline reads it: the facts' fields plus the optional declarations. */
type OutlineQuestion = PlanFactsLike["questions"][number] & {
  forms?: readonly QuestionForm[] | undefined;
  demand?: QuestionDemand | undefined;
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
/** The fixed slots: title, objectives and the closing exit ticket. */
const FIXED_SLOTS = 3;
/** How many terms one vocabulary slide shows at most (the widest theme grid). */
const VOCABULARY_TERMS_MAX = 6;
/** Unshown terms a content slide may carry alongside its key idea. */
const TERMS_PER_CONTENT = 2;
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
  keyIdea?: number;
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
  const workedExamplesOf = (o: number) =>
    ownersOf.flatMap((owners, i) => (owners.includes(o) ? [i] : []));
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
    if (slot.keyIdea !== undefined) used.keyIdeas.add(slot.keyIdea);
    if (slot.workedExample !== undefined) used.workedExamples.add(slot.workedExample);
    if (slot.question !== undefined) used.questions.add(slot.question);
    for (const q of slot.questions ?? []) used.questions.add(q);
    return true;
  };

  const contentSlot = (o: number, k: number): Slot => ({
    kind: "content",
    phase: "explain",
    primary: o,
    objectives: refIndices(facts.keyIdeas[k]?.objectiveRefs),
    keyIdea: k,
    rank: [1, o, 0, k],
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
        q.use === "worksheet" && !used.questions.has(j) && names(q.objectiveRefs, o) ? [j] : [],
      )
      .sort((a, b) => tierRank(a) - tierRank(b) || a - b)[0];
  const firstUnusedKeyIdea = (o: number) => keyIdeasOf(o).find((k) => !used.keyIdeas.has(k));
  const firstUnusedQuestion = (o: number) => questionsOf(o).find((i) => !used.questions.has(i));
  const pickWorkedExample = (among: number[]) => {
    const free = among.filter((x) => !used.workedExamples.has(x));
    return free.find((x) => facts.workedExamples[x]?.misconceptionRef !== undefined) ?? free[0];
  };
  /** The objective with the fewest content slides that still has a key idea to give. */
  const nextKeyIdea = (): [number, number] | undefined => {
    const candidates = all
      .filter((o) => firstUnusedKeyIdea(o) !== undefined)
      .sort((a, b) => contentSlidesOf(a) - contentSlidesOf(b) || a - b);
    const o = candidates[0];
    if (o === undefined) return undefined;
    const k = firstUnusedKeyIdea(o);
    return k === undefined ? undefined : [o, k];
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

  // The essentials P2 will ask for: the required kinds, then the practise slides the shape's
  // answering floor or practise share needs (the exit ticket counts once, the required open
  // question is one of them). When the deck is too short for a content slide per objective plus
  // all of them, the required worked example teaches its own objective instead of a content slide
  // (`refineShape`'s "New to it" rule accepts either); the highest such objective, so the first
  // explain slide stays a content slide. (The exhaustive search over the fixtures found ratio at
  // eight slides: counting the practise share here is what lets the fill reach it.)
  const essentials =
    Number(needVocabulary) +
    Number(needWorkedExample) +
    Number(needOpen) +
    Math.max(0, Math.max(shape.minCheckEntries - 1, practiseFloor) - Number(needOpen));
  let taughtByWorkedExample: number | undefined;
  if (needWorkedExample && budget < count + essentials) {
    taughtByWorkedExample = [...all].reverse().find((o) => workedExamplesOf(o).length > 0);
  }

  // P1: every objective taught, in order.
  for (const o of all) {
    if (taught(o)) continue;
    if (o === taughtByWorkedExample) {
      const x = pickWorkedExample(workedExamplesOf(o));
      if (x !== undefined && place(workedExampleSlot(o, x))) continue;
    }
    const k = firstUnusedKeyIdea(o);
    if (k !== undefined) place(contentSlot(o, k));
  }
  // Four objectives in a six-slide deck: the budget runs out inside P1. Said per objective, so
  // the plan screen can name the one that is not taught rather than the teacher finding out.
  for (const o of all) {
    if (!taught(o) && keyIdeasOf(o).length > 0) {
      gap(`${nth(o)} has a key idea but a ${slideCount}-slide deck has no room to teach it.`);
    }
  }

  // P2: the shape's required kinds and floors.
  if (required.has("vocabulary")) {
    if (!needVocabulary) noMaterial("vocabulary", "vocabulary terms");
    else {
      const terms = facts.vocabulary.slice(0, VOCABULARY_TERMS_MAX).map((_, i) => i);
      const objectives = dedupe(
        terms.flatMap((i) => refIndices(facts.vocabulary[i]?.objectiveRefs)),
      );
      const placed = place({
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
      if (x === undefined || o === undefined || !place(workedExampleSlot(o, x))) {
        noRoom("worked-example");
      }
    }
  }
  // Ruling 81: when the deck has no room for a practise slide per unpractised objective, one
  // shared `instructions` slide asks a question on each (up to four) instead. It comes after the
  // shape's essentials, the open-response included: in an Explain or Evaluate lesson pupils
  // explaining or judging the reach objective in their own words is the lesson's point, and the
  // exit ticket still checks the objectives the shared slide cannot reach.
  const placeSharedPractise = () => {
    if (has("instructions")) return;
    const pending = all.flatMap((o): [number, number][] => {
      if (practised(o)) return [];
      // Four verbatim stems share one slide, and an `instructions` step is capped at an item's
      // length, so only a short question goes on it; an objective with none is left to the exit
      // ticket rather than overflowing the slide.
      const short = (i: number | undefined) =>
        i !== undefined && (facts.questions[i]?.stem.length ?? Infinity) <= SHARED_STEM_MAX;
      const i =
        questionsOf(o).find((j) => !used.questions.has(j) && short(j)) ??
        facts.questions
          .flatMap((q, j) =>
            q.use === "worksheet" && !used.questions.has(j) && names(q.objectiveRefs, o) && short(j)
              ? [j]
              : [],
          )
          .sort((a, b) => tierRank(a) - tierRank(b) || a - b)[0];
      return i === undefined ? [] : [[o, i]];
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
        questionsOf(o).filter((i) => !used.questions.has(i) && admitsOpen(i));
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
    const next = nextKeyIdea();
    if (next === undefined) {
      gap(
        `The shape needs ${shape.minContent} content slides and the facts have key ideas for ${countOf("content")}.`,
      );
      break;
    }
    if (!place(contentSlot(next[0], next[1]))) {
      gap(
        `The shape needs ${shape.minContent} content slides and a ${slideCount}-slide deck has room for ${countOf("content")}.`,
      );
      break;
    }
  }

  // The shape's floors, counted in slides (ruling 82): teaching first, so practice is what a
  // short deck gives up (ruling 81).
  /** Whether a floor stopped because the deck was full (else the facts ran out). */
  const shareFull = { explain: false, practise: false };
  const explainCount = () =>
    slots.filter((s) => s.phase === "explain" && EXPLAIN_KINDS.has(s.kind)).length;
  while (explainCount() < explainFloor) {
    const next = nextKeyIdea();
    const x = next === undefined ? pickWorkedExample(ownedWorkedExamples) : undefined;
    const slot =
      next !== undefined
        ? contentSlot(next[0], next[1])
        : x !== undefined
          ? workedExampleSlot(ownersOf[x]?.[0] ?? 0, x)
          : undefined;
    if (slot === undefined || !place(slot)) {
      if (slot !== undefined) shareFull.explain = true;
      break;
    }
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

  // P6: the rest of the facts — key ideas round-robin, then questions.
  for (let next = nextKeyIdea(); budget > 0 && next !== undefined; next = nextKeyIdea()) {
    place(contentSlot(next[0], next[1]));
  }
  facts.questions.forEach((q, i) => {
    if (budget <= 0 || used.questions.has(i) || !isSlideQuestion(q)) return;
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
  if (budget > 0) {
    gap(
      `The facts allow only ${slots.length + FIXED_SLOTS} slides; the brief asked for ${slideCount}.`,
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
        const k = slot.keyIdea ?? 0;
        const idea = facts.keyIdeas[k];
        refs.push({ type: "keyIdea", index: k });
        const terms = facts.vocabulary
          .flatMap((v, t) => (names(v.objectiveRefs, slot.primary) ? [t] : []))
          .filter((t) => !shownTerms.has(t) && !handedTerms.has(t))
          .slice(0, TERMS_PER_CONTENT);
        for (const t of terms) {
          handedTerms.add(t);
          refs.push({ type: "vocabulary", index: t });
        }
        adds = `Explains: ${idea?.statement ?? ""}`;
        const previous = slots[i - 1];
        if (previous?.kind === "content" && previous.primary === slot.primary) {
          avoids = `Do not repeat: ${facts.keyIdeas[previous.keyIdea ?? 0]?.statement ?? ""}`;
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
        adds = `Your turn: one question on each objective (${questions.length} questions).`;
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

  const exitQuestions = facts.questions.flatMap((q, i) => (q.use === "exit" ? [i] : []));
  outline.push({
    kind: "exit-ticket",
    factRefs: objectiveRefs(all),
    phase: "check",
    brief: brief(`${count} question${count === 1 ? "" : "s"}, one per objective.`),
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
