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

import type { GroupElement, Id, LayoutRef, Lesson, Slide, Theme } from "@tj/domain/documents";
import { fitInto, minFitScale } from "@tj/slides/layout-paths";
import type * as RelayoutKit from "@tj/slides/relayout";
import { uid } from "../factories";
import { renderTheme } from "../themes";
import { editSlide } from "./core";

export type LayoutKit = Pick<
  typeof RelayoutKit,
  | "relayout"
  | "stageOf"
  | "editItem"
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

/** What a layout that cannot be laid out (its template is not live yet) answers. */
export const NOT_LIVE_REASON = "This layout cannot be re-arranged yet.";

type Relaid = ReturnType<LayoutKit["relayout"]>;

/** Run the template for `ref`, or `null` when it cannot lay out: a reducer never throws. */
function tryRelayout(ref: LayoutRef, lesson: Lesson, kit: LayoutKit, id: Id): Relaid | null {
  const theme = renderTheme(lesson);
  try {
    return kit.relayout(ref, theme, kit.stageOf(theme, lesson.ageBand), id);
  } catch {
    return null;
  }
}

/** Put a laid-out `ref` into the group's place: children in group space, the group re-fitted. */
function placeInto(g: GroupElement, ref: LayoutRef, relaid: Relaid, theme: Theme) {
  const { elements, frame } = relaid;
  if (ref.fit) {
    // The resized size, never below where the words still shrink with it (an added item may
    // need a larger minimum than the teacher's size).
    const k = minFitScale(elements, theme);
    ref = {
      ...ref,
      fit: { w: Math.max(ref.fit.w, frame.w * k), h: Math.max(ref.fit.h, frame.h * k) },
    };
    const fit = ref.fit as { w: number; h: number };
    // Resized by the teacher: laid out, then fitted whole into the size they chose, where it is.
    const local = elements.map((e) => ({ ...e, x: e.x - frame.x, y: e.y - frame.y }));
    const natural = { x: 0, y: 0, w: frame.w, h: frame.h };
    g.children = fitInto(local, natural, { x: 0, y: 0, ...fit });
    g.w = fit.w;
    g.h = fit.h;
    g.layout = { ...ref, frame: { ...frame, x: g.x, y: g.y } };
    return;
  }
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

/** Replace the group's ref with `next(ref)` and re-lay it; refused when it cannot lay out. */
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
  const relaid = tryRelayout(out.ref, lesson, kit, groupId);
  if (!relaid) return { lesson, refused: NOT_LIVE_REASON };
  return {
    lesson: editSlide(lesson, slideId, (s) => {
      const g = layoutGroupOf(s, groupId);
      if (g) placeInto(g, out.ref, relaid, renderTheme(lesson));
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
    kit.getAtPath(ref, path) === text ? null : { ok: true, ref: kit.editItem(ref, path, text) },
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
 * same template under the same heading; every word is kept. The new slide holds only the layout,
 * in a fresh group at the template's own place (no lock, rotation or link copied); the notes and
 * the teacher's other elements stay with the head slide. Refused for a layout with no
 * continuation, too few items to halve (Shorten is the way), or a template that cannot lay out.
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
  const tailId = uid();
  const tailGroupId = `${tailId}-layout`;
  const headLaid = tryRelayout(head, lesson, kit, groupId);
  const tailLaid = tryRelayout(tail, lesson, kit, tailGroupId);
  if (!headLaid || !tailLaid) return { lesson, id: null, refused: NOT_LIVE_REASON };
  const moved: GroupElement = {
    id: tailGroupId,
    type: "group",
    ...(g0.name ? { name: g0.name } : {}),
    ...tailLaid.frame,
    children: [],
  };
  placeInto(moved, tail, tailLaid, renderTheme(lesson));
  const copy: Slide = {
    id: tailId,
    kind: slide.kind,
    ...(slide.background ? { background: structuredClone(slide.background) } : {}),
    ...(slide.transition ? { transition: slide.transition } : {}),
    elements: [moved],
  };
  const next = editSlide(lesson, slideId, (s, l) => {
    const g = layoutGroupOf(s, groupId);
    if (!g) return;
    placeInto(g, head, headLaid, renderTheme(lesson));
    l.slides.splice(l.slides.findIndex((x) => x.id === slideId) + 1, 0, copy);
  });
  return { lesson: next, id: next === lesson ? null : tailId };
}
