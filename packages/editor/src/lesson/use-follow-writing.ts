import type { Id } from "@tj/domain/documents";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPlannedBlank } from "./draft-store";

/**
 * Live writing P1 (TEACH-202 part e): while a job writes the lesson, the open slide follows the
 * slide being written (the last `writing` slide in deck order: the writer goes in order, and the
 * objectives slide stays `writing` until the job ends). The shell's pick arrives as
 * `startFollowing` (`initialSlideId` absent: the shell was following).
 *
 * Any act of the teacher stops the follow for good: a click or key press anywhere on the page,
 * focus on a done slide's canvas, or opening a slide by any other route. Only the "Follow
 * writing" chip (`resume`) starts it again. The follow sets the session's active slide and marks
 * it (`mark`, read by the strip through `FollowMarkContext`): the strip scrolls a followed row into
 * view without focusing it, and not at all while the teacher is busy.
 */
export function useFollowWriting({
  slides,
  writingSlideIds,
  activeSlideId,
  setActiveSlide,
  startFollowing,
  canvasFocused,
  lead,
}: {
  slides: readonly { id: Id; elements?: readonly unknown[] }[] | undefined;
  /**
   * Live writing (ADR 0039): the slide whose drafts are streaming now. The writer's later slides
   * wait as blank `writing` slides, so the newest writing slide is not the one being written.
   */
  lead?: Id;
  writingSlideIds: ReadonlySet<Id> | undefined;
  activeSlideId: Id | null;
  setActiveSlide: (id: Id) => void;
  startFollowing: boolean;
  canvasFocused: boolean;
}): {
  following: boolean;
  target: Id | undefined;
  resume: () => void;
  mark: { current: Id | null };
} {
  const [following, setFollowing] = useState(startFollowing);
  const target = useMemo(() => {
    if (!writingSlideIds || !slides) return undefined;
    // The writer goes in order, and its later slides wait as planned blanks. The view never opens
    // a slide with nothing on it (TEACH-202 part f): it stays on the last slide with something to
    // show (its saved copy) until the next slide's draft has words (`lead`, ready drafts only).
    let last = -1;
    for (const [i, s] of slides.entries()) if (writingSlideIds.has(s.id)) last = i;
    let shown: Id | undefined;
    for (const s of slides.slice(0, last + 1)) {
      const waiting = writingSlideIds.has(s.id) && s.elements !== undefined && isPlannedBlank(s);
      if (!waiting) shown = s.id;
      else if (shown !== undefined) break;
    }
    const first = slides[0]?.id;
    // The streaming slide leads, but never back past the slide already shown (a late draft of an
    // earlier slide would pull the view back for a moment).
    const at = (id: Id | undefined) => slides.findIndex((s) => s.id === id);
    if (lead !== undefined && at(lead) >= Math.max(0, at(shown))) return lead;
    return shown ?? first;
  }, [slides, writingSlideIds, lead]);
  /** The slide the follow is opening, until the session reports it open. */
  const mark = useRef<Id | null>(null);
  const previous = useRef(activeSlideId);

  useEffect(() => {
    const moved = activeSlideId !== previous.current;
    previous.current = activeSlideId;
    if (moved) {
      const own = activeSlideId !== null && activeSlideId === mark.current;
      if (!own) {
        // The teacher opened a slide: the follow stops until the chip.
        mark.current = null;
        setFollowing(false);
        return;
      }
    }
    if (!following || !target || target === activeSlideId) return;
    // Forward only: the follow never takes the view back to an earlier slide.
    const at = (id: Id | null) => (slides ?? []).findIndex((s) => s.id === id);
    if (activeSlideId !== null && at(target) < at(activeSlideId)) return;
    mark.current = target;
    setActiveSlide(target);
  }, [activeSlideId, following, target, setActiveSlide, slides]);

  // A click or key press anywhere is the teacher acting (the chip itself excepted).
  const writing = writingSlideIds !== undefined;
  useEffect(() => {
    if (!following || !writing) return;
    const act = (e: Event) => {
      if (e.target instanceof Element && e.target.closest("[data-follow-writing]")) return;
      setFollowing(false);
    };
    document.addEventListener("pointerdown", act, true);
    document.addEventListener("keydown", act, true);
    return () => {
      document.removeEventListener("pointerdown", act, true);
      document.removeEventListener("keydown", act, true);
    };
  }, [following, writing]);

  // Focus on the canvas is an edit starting; a writing slide's canvas is inert, so this is a done one.
  useEffect(() => {
    if (canvasFocused && writing) setFollowing(false);
  }, [canvasFocused, writing]);

  const resume = useCallback(() => setFollowing(true), []);
  return { following, target, resume, mark };
}
