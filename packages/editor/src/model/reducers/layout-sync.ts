/**
 * Teacher edits inside an adaptive layout group (TEACH-205 part b). Run after every edit (`edit`
 * in `core.ts`), so it lands in the same undo step:
 *
 * - new words in a child bound to a field (`<groupId>:<path>`, written by `relayout`) write
 *   through to the group's `layout.input`, so the next re-lay keeps them;
 * - any other change to a child (restyle, move, size, delete, link, alt) or a resize of the group
 *   **detaches** it: the `layout` ref goes and the elements stay exactly as they are. Re-laying
 *   would otherwise throw the teacher's change away. Moving the whole group keeps the ref.
 *
 * A layout reducer replaces `layout` itself, so a group whose ref changed in the edit is left alone.
 */
import {
  boundPath,
  type GroupElement,
  type LayoutRef,
  type Lesson,
  richDocToPlainText,
  type SlideElement,
  setAtPath,
} from "@tj/domain/documents";
import { produce } from "immer";

/** Keys a text edit may change: the words, their provenance, and the height auto-height measures. */
const TEXT_EDIT_KEYS = new Set(["doc", "authoredBy", "generatedFrom", "h"]);

type Verdict = { kind: "keep" } | { kind: "detach" } | { kind: "write"; ref: LayoutRef };

function judge(prev: GroupElement & { layout: LayoutRef }, next: GroupElement): Verdict {
  if (Math.abs(prev.w - next.w) > 0.5 || Math.abs(prev.h - next.h) > 0.5) return { kind: "detach" };
  if (prev.children === next.children) return { kind: "keep" };
  if (prev.children.length !== next.children.length) return { kind: "detach" };
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
  after.slides.forEach((slide, si) => {
    const old = before.slides.find((s) => s.id === slide.id);
    if (!old || old === slide) return;
    slide.elements.forEach((el, ei) => {
      if (el.type !== "group") return;
      const prev = old.elements.find((e) => e.id === el.id);
      if (prev === el || prev?.type !== "group" || !prev.layout) return;
      if (prev.layout !== el.layout) return;
      const verdict = judge(prev as GroupElement & { layout: LayoutRef }, el);
      if (verdict.kind !== "keep") plan.push({ slide: si, el: ei, verdict });
    });
  });
  if (!plan.length) return after;
  return produce(after, (d) => {
    for (const { slide, el, verdict } of plan) {
      const g = d.slides[slide]?.elements[el] as GroupElement | undefined;
      if (!g) continue;
      if (verdict.kind === "detach") delete g.layout;
      else if (verdict.kind === "write") g.layout = verdict.ref;
    }
  });
}
