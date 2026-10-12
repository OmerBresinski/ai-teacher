/**
 * Adaptive layout reducers (TEACH-205 part b; UX rulings 215, 199, 102). A group carrying a
 * `LayoutRef` is a component: editing an item's words, adding an item or removing one changes the
 * ref's input and re-runs its template, replacing the group's children in one undo step. Nothing
 * outside the group moves. A group the teacher moved keeps its offset from where the template put
 * it (`layout.frame`).
 *
 * The template code (`@tj/slides/relayout`, which pulls in every recipe) comes in as `kit`, the
 * way Tidy takes its measurer: the editor loads it only when a layout group is edited, and tests
 * pass the module itself.
 */

import type { GroupElement, Id, LayoutRef, Lesson, Slide } from "@tj/domain/documents";
import type * as RelayoutKit from "@tj/slides/relayout";
import { uid } from "../factories";
import { renderTheme } from "../themes";
import { editSlide } from "./core";

export type LayoutKit = Pick<
  typeof RelayoutKit,
  | "relayout"
  | "stageOf"
  | "setAtPath"
  | "getAtPath"
  | "addItem"
  | "removeItem"
  | "canSplit"
  | "splitItems"
>;

/** A layout change: the lesson (the same object when nothing changed) and, if refused, why. */
export type LayoutChange = { lesson: Lesson; refused?: string };

const layoutGroupOf = (slide: Slide | undefined, groupId: Id) => {
  const g = slide?.elements.find((e) => e.id === groupId);
  return g?.type === "group" && g.layout ? (g as GroupElement & { layout: LayoutRef }) : undefined;
};

const stageFor = (lesson: Lesson, kit: LayoutKit) =>
  kit.stageOf(renderTheme(lesson), lesson.ageBand);

/** Lay `ref` out again into the group's place: children in group space, the group re-fitted. */
function relayInto(g: GroupElement, ref: LayoutRef, lesson: Lesson, kit: LayoutKit) {
  const theme = renderTheme(lesson);
  const { elements, frame } = kit.relayout(ref, theme, kit.stageOf(theme, lesson.ageBand), g.id);
  const old = g.layout?.frame ?? { x: g.x, y: g.y };
  const dx = g.x - old.x;
  const dy = g.y - old.y;
  g.x = frame.x + dx;
  g.y = frame.y + dy;
  g.w = frame.w;
  g.h = frame.h;
  g.children = elements.map((e) => ({ ...e, x: e.x - frame.x, y: e.y - frame.y }));
  g.layout = { ...ref, frame };
}

/** Replace the group's ref with `next(ref)` and re-lay it. */
function change(
  lesson: Lesson,
  slideId: Id,
  groupId: Id,
  kit: LayoutKit,
  next: (ref: LayoutRef) => { ok: true; ref: LayoutRef } | { ok: false; reason: string } | null,
): LayoutChange {
  const g0 = layoutGroupOf(
    lesson.slides.find((s) => s.id === slideId),
    groupId,
  );
  if (!g0) return { lesson };
  const out = next(g0.layout);
  if (!out) return { lesson };
  if (!out.ok) return { lesson, refused: out.reason };
  return {
    lesson: editSlide(lesson, slideId, (s, l) => {
      const g = layoutGroupOf(s, groupId);
      if (g) relayInto(g, out.ref, l, kit);
    }),
  };
}

/** New words for one field (a dotted input path, "grid.1.text"); the same words are a no-op. */
export const editLayoutItem = (
  lesson: Lesson,
  slideId: Id,
  groupId: Id,
  path: string,
  text: string,
  kit: LayoutKit,
): LayoutChange =>
  change(lesson, slideId, groupId, kit, (ref) =>
    kit.getAtPath(ref, path) === text ? null : { ok: true, ref: kit.setAtPath(ref, path, text) },
  );

/** A blank item at `at`; refused at the template's max for the lesson's stage. */
export const addLayoutItem = (
  lesson: Lesson,
  slideId: Id,
  groupId: Id,
  at: number,
  kit: LayoutKit,
): LayoutChange =>
  change(lesson, slideId, groupId, kit, (ref) => kit.addItem(ref, at, stageFor(lesson, kit)));

/** Take out the item at `index`; refused at the template's min. */
export const removeLayoutItem = (
  lesson: Lesson,
  slideId: Id,
  groupId: Id,
  index: number,
  kit: LayoutKit,
): LayoutChange => change(lesson, slideId, groupId, kit, (ref) => kit.removeItem(ref, index));

/**
 * Ruling 215's split: the trailing items move to a new slide right after this one, laid out by the
 * same template under the same heading; every word is kept. The new slide holds only the layout
 * (the teacher's other elements stay where they are). Refused for a layout with no continuation or
 * too few items to halve, where Shorten is the way.
 */
export function splitLayout(
  lesson: Lesson,
  slideId: Id,
  groupId: Id,
  kit: LayoutKit,
): LayoutChange & { id: Id | null } {
  const slide = lesson.slides.find((s) => s.id === slideId);
  const g0 = layoutGroupOf(slide, groupId);
  if (!slide || !g0) return { lesson, id: null };
  if (!kit.canSplit(g0.layout))
    return {
      lesson,
      id: null,
      refused: "This layout cannot split onto a second slide. Shorten the words instead.",
    };
  const { head, tail } = kit.splitItems(g0.layout);
  const { notes: _notes, question: _question, ...rest } = slide;
  const copy: Slide = { ...structuredClone({ ...rest, elements: [] }), id: uid() };
  let id: Id | null = null;
  const next = editSlide(lesson, slideId, (s, l) => {
    const g = layoutGroupOf(s, groupId);
    if (!g) return;
    relayInto(g, head, l, kit);
    const moved: GroupElement = { ...g, id: `${copy.id}-layout`, children: [], layout: tail };
    relayInto(moved, tail, l, kit);
    copy.elements = [moved];
    l.slides.splice(l.slides.findIndex((x) => x.id === slideId) + 1, 0, copy);
    id = copy.id;
  });
  return { lesson: next, id };
}
