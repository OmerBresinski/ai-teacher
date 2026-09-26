/**
 * The objectives slide is the objective editor (ruling 96). Each line of its list carries the id of
 * the objective it stands for (`attrs.factId`, stamped by `materialiseObjectives`), so writing the
 * line's words writes that objective in the same reducer — one undo step (ruling 44, ADR 0022 §4).
 * Nothing on any other slide changes here; the teacher asks for that with "Update them".
 */

import {
  type FactId,
  type Id,
  type IgnoredCheck,
  type Lesson,
  objectiveFromLine,
  objectiveLine,
  objectiveListLines,
  type RichDoc,
  stampObjectiveIds,
} from "@tj/domain/documents";
import { edit, findElement } from "./core";
import { updateElement } from "./elements";
import { nextFactId } from "./facts";

/** One to four objectives (ruling 64): a fifth line is never saved as one. */
export const MAX_OBJECTIVES = 4;

/**
 * Which objective each line of the objectives slide's list stands for, in line order; `null` for a
 * line that is not one (a new line not yet saved, a fifth line, an empty line). A stamped id
 * counts once: a second line carrying the same id (a duplicated line) is not that objective. A
 * lesson from before the ids were stamped is matched by position, and only when the line count
 * equals the objective count. `null` — nothing is read or written through — when the counts of an
 * unstamped list disagree, the slide is not an objectives slide or the box holds no list.
 */
export function objectiveLineIds(
  lesson: Lesson,
  slideId: Id,
  elementId: Id,
): (FactId | null)[] | null {
  const slide = lesson.slides.find((s) => s.id === slideId);
  const facts = lesson.facts;
  if (slide?.kind !== "objectives" || !facts) return null;
  const element = findElement(slide, elementId);
  if (element?.type !== "text") return null;
  const lines = objectiveListLines(element.doc);
  if (!lines) return null;
  const known = new Set(facts.objectives.map((o) => o.id));
  const stamped = lines.some((l) => l.factId !== null && known.has(l.factId));
  if (!stamped) {
    return lines.length === facts.objectives.length ? facts.objectives.map((o) => o.id) : null;
  }
  const used = new Set<FactId>();
  return lines.map((line) => {
    const id = line.factId;
    if (id === null || !known.has(id) || used.has(id)) return null;
    used.add(id);
    return id;
  });
}

/**
 * Write the objectives slide's list through to `facts.objectives` (ruling 96):
 * - a line that stands for an objective and has words sets that objective's text (the stored
 *   phrase never carries the slide's stem, ruling 64);
 * - a new line with words, while the lesson has fewer than four objectives, becomes a new
 *   objective with the next free id, and the id is stamped on the line;
 * - an empty line, a fifth line, or a list in a lesson that cannot be matched writes nothing.
 * `reserved` are fact ids in use outside the lesson (the worksheet's refs); `null` while they are
 * not known yet, in which case no new objective is made. Identity on a no-op.
 */
export function writeObjectiveLines(
  lesson: Lesson,
  slideId: Id,
  elementId: Id,
  reserved: readonly string[] | null = [],
): Lesson {
  const ids = objectiveLineIds(lesson, slideId, elementId);
  const facts = lesson.facts;
  if (!ids || !facts) return lesson;
  const slide = lesson.slides.find((s) => s.id === slideId);
  const element = slide ? findElement(slide, elementId) : undefined;
  if (element?.type !== "text") return lesson;
  const lines = objectiveListLines(element.doc) ?? [];

  const texts = new Map<FactId, string>();
  const added: { id: FactId; text: string }[] = [];
  let count = facts.objectives.length;
  const lineIds = lines.map((line, i) => {
    const id = ids[i] ?? null;
    if (line.text === "") return id;
    if (id !== null) {
      const current = facts.objectives.find((o) => o.id === id);
      if (current && objectiveLine(current.text) !== line.text) {
        texts.set(id, objectiveFromLine(line.text));
      }
      return id;
    }
    if (reserved === null || count >= MAX_OBJECTIVES) return null;
    const minted = nextFactId(lesson, "objective", [...reserved, ...added.map((a) => a.id)]);
    added.push({ id: minted, text: objectiveFromLine(line.text) });
    count += 1;
    return minted;
  });
  // E3 pending: an objective whose line was removed stays in `facts.objectives`, as before this
  // change; what a deleted, moved, split or merged line does to its objective is a separate design.

  const doc = stampObjectiveIds(element.doc, lineIds);
  return edit(lesson, (draft) => {
    const draftFacts = draft.facts;
    if (!draftFacts) return;
    for (const objective of draftFacts.objectives) {
      const text = texts.get(objective.id);
      if (text !== undefined && objective.text !== text) objective.text = text;
    }
    for (const a of added) draftFacts.objectives.push({ id: a.id, text: a.text });
    if (doc !== element.doc) {
      const draftSlide = draft.slides.find((s) => s.id === slideId);
      const draftElement = draftSlide ? findElement(draftSlide, elementId) : undefined;
      if (draftElement?.type === "text") draftElement.doc = doc as typeof draftElement.doc;
    }
  });
}

/**
 * The one write path for an element's rich text from the canvas: the doc, and — on the objectives
 * slide — the objectives it stands for, in one reducer so they are one undo step.
 */
export const writeElementDoc = (
  lesson: Lesson,
  slideId: Id,
  id: Id,
  doc: RichDoc,
  reserved: readonly string[] | null = [],
): Lesson =>
  writeObjectiveLines(
    updateElement(lesson, slideId, id, { doc } as Parameters<typeof updateElement>[3]),
    slideId,
    id,
    reserved,
  );

/**
 * "Ignore" on a warning about one fact (ruling 96): the check stays quiet for that fact from now
 * on, on every device, until undone. Identity when it is already ignored.
 */
export const ignoreCheck = (lesson: Lesson, check: string, factId: FactId): Lesson => {
  if (lesson.ignoredChecks?.some((i) => i.check === check && i.factId === factId)) return lesson;
  return edit(lesson, (draft) => {
    const entry: IgnoredCheck = { check, factId };
    if (draft.ignoredChecks) draft.ignoredChecks.push(entry);
    else draft.ignoredChecks = [entry];
  });
};
