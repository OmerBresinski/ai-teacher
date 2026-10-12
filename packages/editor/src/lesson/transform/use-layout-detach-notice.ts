import type { Slide } from "@tj/domain/documents";
import { toast } from "@tj/ui";
import { useEffect, useRef } from "react";

/** What a teacher is told when an edit inside a layout group fixes it (TEACH-205 part b). */
export const DETACH_NOTICE = "This layout is now fixed: items won't re-arrange any more";

/**
 * Tells the teacher when an edit turned an adaptive layout group into fixed elements
 * (`syncLayoutGroups` dropped its ref): a group that had a `layout` on this slide and still exists
 * without one. Ungrouping removes the group, so it says nothing; an undo that brings the ref back
 * says nothing either.
 */
export function useLayoutDetachNotice(slide: Slide): void {
  const seen = useRef<{ slideId: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    const now = new Set<string>();
    for (const el of slide.elements) if (el.type === "group" && el.layout) now.add(el.id);
    const prev = seen.current;
    if (prev && prev.slideId === slide.id) {
      const fixed = slide.elements.some(
        (el) => el.type === "group" && !el.layout && prev.ids.has(el.id),
      );
      if (fixed) toast(DETACH_NOTICE);
    }
    seen.current = { slideId: slide.id, ids: now };
  }, [slide]);
}
