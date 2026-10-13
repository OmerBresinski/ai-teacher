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

import {
  type GroupElement,
  type Id,
  type LayoutRef,
  type Lesson,
  richDocToPlainText,
  type Slide,
  type SlideElement,
  type Theme,
} from "@tj/domain/documents";
import { boundPath, fitInto, minFitScale } from "@tj/slides/layout-paths";
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
export function tryRelayout(ref: LayoutRef, lesson: Lesson, kit: LayoutKit, id: Id): Relaid | null {
  const theme = renderTheme(lesson);
  try {
    return kit.relayout(ref, theme, kit.stageOf(theme, lesson.ageBand), id);
  } catch {
    return null;
  }
}

/** Put a laid-out `ref` into the group's place: children in group space, the group re-fitted. */
export function placeInto(g: GroupElement, ref: LayoutRef, relaid: Relaid, theme: Theme) {
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

/**
 * "Free layout" on (TEACH-205 part b): the layout group becomes ordinary boxes, each exactly where
 * it was, as the Ungroup command makes them, and the group (without its children) is kept on the
 * slide so the teacher can turn Free layout off again. One slide holds one freed layout: freeing a
 * second one is refused until the first is tidied.
 */
export function freeLayout(lesson: Lesson, slideId: Id, groupId: Id): LayoutChange & { ids: Id[] } {
  const slide = lesson.slides.find((s) => s.id === slideId);
  const g0 = layoutGroupOf(slide, groupId);
  if (!slide || !g0) return { lesson, ids: [] };
  if (slide.freeLayout)
    return { lesson, ids: [], refused: "Tidy this slide's other free layout first." };
  const ids = g0.children.map((c) => c.id);
  const next = editSlide(lesson, slideId, (s) => {
    const idx = s.elements.findIndex((e) => e.id === groupId);
    const g = s.elements[idx] as GroupElement & { layout: LayoutRef };
    const freed: SlideElement[] = g.children.map((c) => ({ ...c, x: c.x + g.x, y: c.y + g.y }));
    s.elements.splice(idx, 1, ...freed);
    s.freeLayout = {
      id: g.id,
      ...(g.name ? { name: g.name } : {}),
      x: g.x,
      y: g.y,
      w: g.w,
      h: g.h,
      layout: g.layout,
    };
  });
  return { lesson: next, ids };
}

/**
 * "Free layout" off: the freed layout is laid out again from its template where it was. The words
 * typed into its freed boxes are kept (each box still has its `<groupId>:<path>` id); moves, sizes
 * and restyles go, and a box deleted from it comes back with the words it last had. Boxes the
 * teacher added stay where they are. Refused when the template cannot lay out (nothing changes).
 */
export function tidyLayout(
  lesson: Lesson,
  slideId: Id,
  kit: LayoutKit,
): LayoutChange & { id: Id | null } {
  const slide = lesson.slides.find((s) => s.id === slideId);
  const stash = slide?.freeLayout;
  if (!slide || !stash) return { lesson, id: null };
  let ref = stash.layout;
  const own = (e: SlideElement) => e.id.startsWith(`${stash.id}:`);
  const plain = (e: SlideElement | undefined) => {
    const doc = (e as { doc?: unknown } | undefined)?.doc;
    return doc ? richDocToPlainText(doc as never) : undefined;
  };
  // A box's words count as typed only when they differ from what the template drew for them: a
  // template may draw a word differently from how it stores it (a card label in capitals).
  const drawn = tryRelayout(stash.layout, lesson, kit, stash.id);
  if (!drawn) return { lesson, id: null, refused: NOT_LIVE_REASON };
  const before = new Map(drawn.elements.map((e) => [e.id, plain(e)]));
  for (const el of slide.elements) {
    const path = boundPath(stash.id, el.id);
    const words = plain(el);
    if (!path || words === undefined || words === before.get(el.id)) continue;
    ref = kit.editItem(ref, path, words);
  }
  const relaid = tryRelayout(ref, lesson, kit, stash.id);
  if (!relaid) return { lesson, id: null, refused: NOT_LIVE_REASON };
  const next = editSlide(lesson, slideId, (s) => {
    const first = s.elements.findIndex(own);
    const at = first < 0 ? s.elements.length : first;
    const group: GroupElement = {
      id: stash.id,
      type: "group",
      ...(stash.name ? { name: stash.name } : {}),
      x: stash.x,
      y: stash.y,
      w: stash.w,
      h: stash.h,
      children: [],
      layout: stash.layout,
    };
    placeInto(group, ref, relaid, renderTheme(lesson));
    s.elements = s.elements.filter((e) => !own(e));
    s.elements.splice(Math.min(at, s.elements.length), 0, group);
    delete s.freeLayout;
  });
  return { lesson: next, id: stash.id };
}
