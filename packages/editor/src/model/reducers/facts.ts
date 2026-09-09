/**
 * Facts and proposals (ADR 0025 §1, §18, §19): the teacher's edits to `Lesson.facts` and the
 * application of what a `lesson.cascade` / `lesson.regenerate` job returned. All pure; identity on
 * a no-op so the history hook records nothing. Elements keep their `generatedFrom.factRefs` when a
 * fact is removed — a dangling ref means "no longer cascades", nothing more.
 */

import type { Proposal } from "@tj/domain";
import type {
  FactId,
  FactQuestion,
  Id,
  KeyIdea,
  Lesson,
  LessonFacts,
  Misconception,
  Objective,
  SlideElement,
  VocabularyItem,
  WorkedExample,
  Worksheet,
} from "@tj/domain/documents";
import { edit, type WithId } from "./core";

/**
 * Every fact kind the panel knows. Key ideas and misconceptions (Generation quality §1) are shown
 * read-only and can be removed; adding or editing them is not yet a panel feature, so
 * `FactValues` covers the four `EditableFactKind`s only.
 */
export type FactKind =
  | "objective"
  | "keyIdea"
  | "vocabulary"
  | "workedExample"
  | "question"
  | "misconception";
export type EditableFactKind = Exclude<FactKind, "keyIdea" | "misconception">;

/** The one-letter prefix each kind's ids carry (`o1`, `k1`, `v3`, `x2`, `q4`, `m1`), as the worker mints them. */
export const FACT_ID_PREFIX: Record<FactKind, string> = {
  objective: "o",
  keyIdea: "k",
  vocabulary: "v",
  workedExample: "x",
  question: "q",
  misconception: "m",
};

const LIST_OF: Record<FactKind, keyof LessonFacts> = {
  objective: "objectives",
  keyIdea: "keyIdeas",
  vocabulary: "vocabulary",
  workedExample: "workedExamples",
  question: "questions",
  misconception: "misconceptions",
};

export type FactPatch =
  | Partial<Pick<Objective, "text">>
  | Partial<Pick<VocabularyItem, "term" | "definition">>
  | Partial<Pick<WorkedExample, "problem" | "steps" | "answer">>
  | Partial<Pick<FactQuestion, "stem" | "answer" | "reasoning">>;

export type FactValues =
  | { kind: "objective"; text: string }
  | { kind: "vocabulary"; term: string; definition: string }
  | { kind: "workedExample"; problem: string; steps: string[]; answer: string }
  | { kind: "question"; stem: string; answer: string; reasoning: string };

type AnyFact = Objective | KeyIdea | VocabularyItem | WorkedExample | FactQuestion | Misconception;

/** The fact list under `key`; `keyIdeas` is optional on the document, so absent reads as empty. */
const listOf = (facts: LessonFacts, key: keyof LessonFacts): AnyFact[] =>
  (facts[key] as AnyFact[] | undefined) ?? [];

function findFact(facts: LessonFacts, factId: FactId): AnyFact | undefined {
  for (const key of Object.values(LIST_OF)) {
    const found = listOf(facts, key).find((f) => f.id === factId);
    if (found) return found;
  }
  return undefined;
}

/** Patch one fact's text fields; unknown ids and unchanged values are a no-op. */
export const updateFact = (lesson: Lesson, factId: FactId, patch: FactPatch): Lesson =>
  edit(lesson, (draft) => {
    if (!draft.facts) return;
    const fact = findFact(draft.facts, factId);
    if (!fact) return;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const current = (fact as Record<string, unknown>)[key];
      const same = Array.isArray(value)
        ? Array.isArray(current) &&
          current.length === value.length &&
          current.every((v, i) => v === value[i])
        : current === value;
      if (!same) (fact as Record<string, unknown>)[key] = value;
    }
  });

/** Every fact id the worksheet's blocks derive from — what `addFact` must not mint again. */
export function worksheetFactRefs(worksheet: Worksheet | undefined): readonly string[] {
  if (!worksheet) return [];
  const refs = new Set<string>();
  for (const block of worksheet.blocks) {
    for (const ref of block.generatedFrom?.factRefs ?? []) refs.add(ref);
  }
  return [...refs];
}

/**
 * The next id for a kind: one past the highest number anything still points at — the facts
 * themselves, the outline's `factRefs`, every element's `generatedFrom.factRefs` (elements keep
 * their refs when a fact is removed) and `reserved`, the caller's ids from documents the reducer
 * cannot see (`worksheetFactRefs`). An id nothing references any more may come round again; that
 * is harmless, since no dangling ref can then be read as pointing at the new fact.
 */
export function nextFactId(
  lesson: Lesson,
  kind: FactKind,
  reserved: Iterable<string> = [],
): FactId {
  const facts = lesson.facts;
  const prefix = FACT_ID_PREFIX[kind];
  let max = 0;
  const bump = (id: string) => {
    if (!id.startsWith(prefix)) return;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  };
  if (facts) {
    for (const key of Object.values(LIST_OF)) for (const f of listOf(facts, key)) bump(f.id);
    for (const entry of facts.outline) for (const ref of entry.factRefs) bump(ref);
  }
  const walk = (elements: readonly SlideElement[]) => {
    for (const element of elements) {
      for (const ref of element.generatedFrom?.factRefs ?? []) bump(ref);
      if (element.type === "group") walk(element.children);
    }
  };
  for (const slide of lesson.slides) walk(slide.elements);
  for (const ref of reserved) bump(ref);
  return `${prefix}${max + 1}`;
}

/**
 * Append a fact of `kind`; returns the id it minted. `reserved` are ids in use outside the lesson
 * (the worksheet's block refs). A lesson without facts is a no-op.
 */
export function addFact(
  lesson: Lesson,
  values: FactValues,
  reserved: Iterable<string> = [],
): WithId<"id", FactId | null> {
  if (!lesson.facts) return { lesson, id: null };
  const id = nextFactId(lesson, values.kind, reserved);
  const next = edit(lesson, (draft) => {
    const facts = draft.facts;
    if (!facts) return;
    switch (values.kind) {
      case "objective":
        facts.objectives.push({ id, text: values.text });
        break;
      case "vocabulary":
        facts.vocabulary.push({ id, term: values.term, definition: values.definition });
        break;
      case "workedExample":
        facts.workedExamples.push({
          id,
          problem: values.problem,
          steps: values.steps,
          answer: values.answer,
        });
        break;
      case "question":
        facts.questions.push({
          id,
          stem: values.stem,
          answer: values.answer,
          reasoning: values.reasoning,
        });
        break;
    }
  });
  return { lesson: next, id };
}

/**
 * Remove a fact, every outline reference to it and every link another fact holds to it
 * (`objectiveRefs`, `misconceptionRef` on worked examples and distractors). Elements are untouched.
 */
export const removeFact = (lesson: Lesson, factId: FactId): Lesson =>
  edit(lesson, (draft) => {
    const facts = draft.facts;
    if (!facts) return;
    let removed = false;
    for (const key of Object.values(LIST_OF)) {
      const list = listOf(facts, key);
      const index = list.findIndex((f) => f.id === factId);
      if (index !== -1) {
        list.splice(index, 1);
        removed = true;
      }
    }
    if (!removed) return;
    for (const entry of facts.outline) dropAll(entry.factRefs, factId);
    dropLinksTo(facts, factId);
  });

/** Remove every occurrence of `id` from `refs` in place (a duplicated ref must not survive). */
function dropAll(refs: FactId[], id: FactId): void {
  for (let i = refs.length - 1; i >= 0; i--) if (refs[i] === id) refs.splice(i, 1);
}

/** Drop `factId` from every fact's own links; an empty optional list is removed, not left `[]`. */
function dropLinksTo(facts: LessonFacts, factId: FactId): void {
  const prune = (fact: { objectiveRefs?: FactId[] }, required: boolean) => {
    if (!fact.objectiveRefs?.includes(factId)) return;
    dropAll(fact.objectiveRefs, factId);
    if (!required && fact.objectiveRefs.length === 0) delete fact.objectiveRefs;
  };
  for (const k of facts.keyIdeas ?? []) prune(k, true);
  for (const m of facts.misconceptions) prune(m, true);
  for (const v of facts.vocabulary) prune(v, false);
  for (const q of facts.questions) {
    prune(q, false);
    for (const d of q.distractors ?? [])
      if (d.misconceptionRef === factId) delete d.misconceptionRef;
  }
  for (const x of facts.workedExamples)
    if (x.misconceptionRef === factId) delete x.misconceptionRef;
}

/* ------------------------------------------------------------------ */
/* Proposals                                                           */
/* ------------------------------------------------------------------ */

/** Replace `id` in place — at the top level or inside a group — with `next`. */
function replaceElement(elements: SlideElement[], id: Id, next: SlideElement): boolean {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el) continue;
    if (el.id === id) {
      elements[i] = next;
      return true;
    }
    if (el.type === "group" && replaceElement(el.children, id, next)) return true;
  }
  return false;
}

/**
 * Apply a job's slide proposals (ADR 0025 §19). An `elementId` proposal replaces that element in
 * place (same index, the proposal's id); the proposals for a slide without `elementId` replace the
 * slide's whole `elements` in proposal order, and the slide keeps its `id` and `kind`. `question`
 * and `notes` on whole-slide proposals are applied once per slide: `notes: null` clears the old
 * notes, an absent `question` on a whole-slide replacement clears the old answer data (the element
 * ids it named are gone). Block proposals are ignored here — see `applyBlockProposals`.
 */
export const applyProposals = (lesson: Lesson, proposals: readonly Proposal[]): Lesson =>
  edit(lesson, (draft) => {
    const wholeSlides = new Map<Id, Proposal[]>();
    for (const proposal of proposals) {
      const { slideId, elementId } = proposal.target;
      if (slideId === undefined || proposal.element === undefined) continue;
      if (elementId === undefined) {
        const list = wholeSlides.get(slideId) ?? [];
        list.push(proposal);
        wholeSlides.set(slideId, list);
        continue;
      }
      const slide = draft.slides.find((s) => s.id === slideId);
      if (!slide) continue;
      replaceElement(slide.elements, elementId, proposal.element);
    }
    for (const [slideId, list] of wholeSlides) {
      const slide = draft.slides.find((s) => s.id === slideId);
      if (!slide) continue;
      slide.elements = list.flatMap((p) => (p.element ? [p.element] : []));
      const withQuestion = list.find((p) => p.question !== undefined);
      if (withQuestion?.question) slide.question = withQuestion.question;
      else delete slide.question;
      const withNotes = list.find((p) => p.notes !== undefined);
      if (withNotes) {
        if (withNotes.notes === null) delete slide.notes;
        else slide.notes = withNotes.notes;
      }
    }
  });

/** The slides a set of proposals touches, in document order (for the toast and the busy overlay). */
export function proposalSlideIds(lesson: Lesson, proposals: readonly Proposal[]): Id[] {
  const ids = new Set(proposals.flatMap((p) => (p.target.slideId ? [p.target.slideId] : [])));
  return lesson.slides.filter((s) => ids.has(s.id)).map((s) => s.id);
}
