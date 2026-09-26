import {
  type FactId,
  type Finding,
  type Id,
  type Lesson,
  objectiveListLines,
  type Slide,
  teachingSlides,
} from "@tj/domain/documents";
import { MAX_OBJECTIVES, objectiveLineIds } from "../../model/reducers";
import { slidesReferencing } from "../impact-preview";

/*
 * What the objectives slide's lines say about the objectives they stand for (ruling 96), as data:
 * the canvas overlay (`ObjectiveNotes`) draws it, the tests read it. Pure. Editor-only by
 * construction: nothing here is on the document, so present, export, print and thumbnails never
 * see it.
 */

export type ObjectiveNote =
  /** No slide teaches the objective (`objective-taught`, ruling 81): amber, with Add and Ignore. */
  | { kind: "not-taught"; elementId: Id; line: number; factId: FactId; afterSlideId: Id }
  /** The line was reworded while the box is selected and AI slides cite the objective. */
  | { kind: "old-wording"; elementId: Id; line: number; factId: FactId; slides: number[] }
  /** A line past the fourth objective (ruling 64): red, not saved. */
  | { kind: "over-cap"; elementId: Id; line: number }
  /** The box has no objective left in it (ruling 64): red, on the box. */
  | { kind: "empty"; elementId: Id };

export type ObjectiveNoteInput = {
  lesson: Lesson;
  slide: Slide;
  /** The residual findings (live schema checks included). */
  findings: readonly Finding[];
  /** The element ids selected on the canvas. */
  selection: readonly Id[];
  /** The objectives' words when the box was selected; `null` when it is not selected. */
  wordingAtSelect: ReadonlyMap<FactId, string> | null;
  /** Objectives whose "Update them" was already clicked while the box stayed selected. */
  updated: ReadonlySet<FactId>;
};

export function objectiveNotes({
  lesson,
  slide,
  findings,
  selection,
  wordingAtSelect,
  updated,
}: ObjectiveNoteInput): ObjectiveNote[] {
  const facts = lesson.facts;
  if (slide.kind !== "objectives" || !facts) return [];
  const untaught = new Set(
    findings
      .filter((f) => f.check === "objective-taught" && f.target.factId !== undefined)
      .map((f) => f.target.factId as FactId),
  );
  const notes: ObjectiveNote[] = [];
  for (const element of slide.elements) {
    if (element.type !== "text") continue;
    const lines = objectiveListLines(element.doc);
    const ids = objectiveLineIds(lesson, slide.id, element.id);
    if (!lines || !ids) continue;
    if (lines.every((l) => l.text === "")) {
      notes.push({ kind: "empty", elementId: element.id });
      continue;
    }
    const selected = selection.includes(element.id);
    lines.forEach((line, i) => {
      const factId = ids[i] ?? null;
      if (factId === null) {
        const full = facts.objectives.length >= MAX_OBJECTIVES;
        if (line.text !== "" && full)
          notes.push({ kind: "over-cap", elementId: element.id, line: i });
        return;
      }
      if (untaught.has(factId)) {
        notes.push({
          kind: "not-taught",
          elementId: element.id,
          line: i,
          factId,
          afterSlideId: slideAfterForObjective(lesson, slide.id, factId),
        });
      }
      if (!selected || !wordingAtSelect || updated.has(factId)) return;
      const before = wordingAtSelect.get(factId);
      const now = facts.objectives.find((o) => o.id === factId)?.text;
      if (before === undefined || now === undefined || before === now) return;
      const numbers = slidesReferencing(lesson, [factId])
        .filter((id) => id !== slide.id)
        .map((id) => lesson.slides.findIndex((s) => s.id === id) + 1);
      if (numbers.length > 0) {
        notes.push({
          kind: "old-wording",
          elementId: element.id,
          line: i,
          factId,
          slides: numbers,
        });
      }
    });
  }
  return notes;
}

/**
 * Where "Add a slide" puts the new slide for an objective no slide teaches: after the last slide
 * teaching an objective listed before it, so the lesson keeps its order; otherwise straight after
 * the objectives slide.
 */
export function slideAfterForObjective(lesson: Lesson, objectivesSlideId: Id, factId: FactId): Id {
  const objectives = lesson.facts?.objectives ?? [];
  const teaching = teachingSlides(lesson);
  const at = objectives.findIndex((o) => o.id === factId);
  for (let i = at - 1; i >= 0; i--) {
    const slides = teaching.get(objectives[i]?.id ?? "") ?? [];
    const last = slides[slides.length - 1];
    if (last) return last;
  }
  return objectivesSlideId;
}

/** "Slides 4 and 5 use the old wording" / "Slide 4 uses the old wording". */
export function oldWordingSentence(slides: readonly number[]): string {
  if (slides.length === 1) return `Slide ${slides[0]} uses the old wording`;
  const list = `${slides.slice(0, -1).join(", ")} and ${slides[slides.length - 1]}`;
  return `Slides ${list} use the old wording`;
}
