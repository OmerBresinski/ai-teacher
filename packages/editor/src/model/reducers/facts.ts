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
  Lesson,
  LessonFacts,
  Objective,
  SlideElement,
  VocabularyItem,
  WorkedExample,
} from "@tj/domain/documents";
import { edit, type WithId } from "./core";

export type FactKind = "objective" | "vocabulary" | "workedExample" | "question";

/** The one-letter prefix each kind's ids carry (`o1`, `v3`, `x2`, `q4`), as the worker mints them. */
export const FACT_ID_PREFIX: Record<FactKind, string> = {
  objective: "o",
  vocabulary: "v",
  workedExample: "x",
  question: "q",
};

const LIST_OF: Record<FactKind, keyof LessonFacts> = {
  objective: "objectives",
  vocabulary: "vocabulary",
  workedExample: "workedExamples",
  question: "questions",
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

type AnyFact = Objective | VocabularyItem | WorkedExample | FactQuestion;

function findFact(facts: LessonFacts, factId: FactId): AnyFact | undefined {
  for (const key of Object.values(LIST_OF)) {
    const found = (facts[key] as AnyFact[]).find((f) => f.id === factId);
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

/** The next free id for a kind: one past the highest number in use, never reusing a removed one. */
export function nextFactId(facts: LessonFacts, kind: FactKind): FactId {
  const prefix = FACT_ID_PREFIX[kind];
  let max = 0;
  const bump = (id: string) => {
    if (!id.startsWith(prefix)) return;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  };
  for (const key of Object.values(LIST_OF)) for (const f of facts[key] as AnyFact[]) bump(f.id);
  // Outline refs may name an id that has since been removed; never reuse it either.
  for (const entry of facts.outline) for (const ref of entry.factRefs) bump(ref);
  return `${prefix}${max + 1}`;
}

/** Append a fact of `kind`; returns the id it minted. A lesson without facts is a no-op. */
export function addFact(lesson: Lesson, values: FactValues): WithId<"id", FactId | null> {
  if (!lesson.facts) return { lesson, id: null };
  const id = nextFactId(lesson.facts, values.kind);
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

/** Remove a fact and every outline reference to it. Elements are untouched. */
export const removeFact = (lesson: Lesson, factId: FactId): Lesson =>
  edit(lesson, (draft) => {
    const facts = draft.facts;
    if (!facts) return;
    let removed = false;
    for (const key of Object.values(LIST_OF)) {
      const list = facts[key] as AnyFact[];
      const index = list.findIndex((f) => f.id === factId);
      if (index !== -1) {
        list.splice(index, 1);
        removed = true;
      }
    }
    if (!removed) return;
    for (const entry of facts.outline) {
      const at = entry.factRefs.indexOf(factId);
      if (at !== -1) entry.factRefs.splice(at, 1);
    }
  });

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
