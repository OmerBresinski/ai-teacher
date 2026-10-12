/**
 * Teacher edits inside an adaptive layout group (TEACH-205 part b). The lesson history runs it on
 * every teacher edit before writing (`useDocumentHistory`'s `settle`), so it lands in the same undo
 * step; silent measurements skip it:
 *
 * - new words in a child bound to a field (`<groupId>:<path>`, written by `relayout`) write
 *   through to the group's `layout.input`, so the next re-lay keeps them;
 * - a resize of the group re-lays it into the new size (`layout.fit`): fitted whole, never squashed;
 * - any other change to a child (restyle, move, size, delete, link, alt) **detaches** the group:
 *   the `layout` ref goes and the elements stay exactly as they are. Re-laying would otherwise
 *   throw the teacher's change away. Moving the whole group keeps the ref.
 *
 * A layout reducer replaces `layout` itself, so a group whose ref changed in the edit is left alone.
 */
import {
  type GroupElement,
  type LayoutRef,
  type Lesson,
  richDocToPlainText,
  type SlideElement,
  type Theme,
} from "@tj/domain/documents";
import { boundPath, fitInto, minLayoutSize, setAtPath } from "@tj/slides/layout-paths";
import { produce } from "immer";
import { renderTheme } from "../themes";

/** Keys a text edit may change: the words, their provenance, and the height auto-height measures. */
const TEXT_EDIT_KEYS = new Set(["doc", "authoredBy", "generatedFrom", "h"]);

type Verdict =
  | { kind: "keep" }
  | { kind: "detach" }
  | { kind: "write"; ref: LayoutRef; children?: SlideElement[] };

function judge(
  prev: GroupElement & { layout: LayoutRef },
  next: GroupElement,
  theme: Theme,
): Verdict {
  // A child added, removed or swapped (a delete re-fits the group too): detach, never re-lay.
  if (
    prev.children.length !== next.children.length ||
    prev.children.some((c, i) => c.id !== next.children[i]?.id)
  )
    return { kind: "detach" };
  if (Math.abs(prev.w - next.w) > 0.5 || Math.abs(prev.h - next.h) > 0.5) {
    // A resize re-lays into the new size: the layout as it was, fitted whole (one scale, centred),
    // never the gesture's stretched boxes. The size is kept on the ref for every later re-lay.
    // Never below the size where its words still shrink with it: there it stops, as a resize
    // stops at an element's minimum elsewhere (the gesture clamps the same way).
    const min = minLayoutSize(prev, theme);
    const fit = { w: Math.max(next.w, min.w), h: Math.max(next.h, min.h) };
    const children = fitInto(
      prev.children,
      { x: 0, y: 0, w: prev.w, h: prev.h },
      { x: 0, y: 0, ...fit },
    );
    return { kind: "write", ref: { ...prev.layout, fit }, children };
  }
  if (prev.children === next.children) return { kind: "keep" };
  let ref = prev.layout;
  for (let i = 0; i < next.children.length; i++) {
    const a = prev.children[i] as SlideElement;
    const b = next.children[i] as SlideElement;
    if (a === b) continue;
    if (a.id !== b.id) return { kind: "detach" };
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (TEXT_EDIT_KEYS.has(k)) continue;
      const va = (a as Record<string, unknown>)[k];
      const vb = (b as Record<string, unknown>)[k];
      if (va !== vb && JSON.stringify(va) !== JSON.stringify(vb)) return { kind: "detach" };
    }
    const da = (a as { doc?: unknown }).doc;
    const db = (b as { doc?: unknown }).doc;
    if (da === db || !db) continue;
    const path = boundPath(next.id, b.id);
    if (!path) return { kind: "detach" };
    ref = setAtPath(ref, path, richDocToPlainText(db as never));
  }
  return ref === prev.layout ? { kind: "keep" } : { kind: "write", ref };
}

/** `after` with every layout group the edit touched written through or detached (see above). */
export function syncLayoutGroups(before: Lesson, after: Lesson): Lesson {
  if (before === after) return after;
  const plan: { slide: number; el: number; verdict: Verdict }[] = [];
  const theme = renderTheme(after);
  after.slides.forEach((slide, si) => {
    const old = before.slides.find((s) => s.id === slide.id);
    if (!old || old === slide) return;
    slide.elements.forEach((el, ei) => {
      if (el.type !== "group") return;
      const prev = old.elements.find((e) => e.id === el.id);
      if (prev === el || prev?.type !== "group" || !prev.layout) return;
      if (prev.layout !== el.layout) return;
      const verdict = judge(prev as GroupElement & { layout: LayoutRef }, el, theme);
      if (verdict.kind !== "keep") plan.push({ slide: si, el: ei, verdict });
    });
  });
  if (!plan.length) return after;
  return produce(after, (d) => {
    for (const { slide, el, verdict } of plan) {
      const g = d.slides[slide]?.elements[el] as GroupElement | undefined;
      if (!g) continue;
      if (verdict.kind === "detach") delete g.layout;
      else if (verdict.kind === "write") {
        g.layout = verdict.ref;
        if (verdict.children) g.children = verdict.children;
        if (verdict.ref.fit) {
          g.w = verdict.ref.fit.w;
          g.h = verdict.ref.fit.h;
        }
      }
    }
  });
}
