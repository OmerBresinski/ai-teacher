import type { Id } from "@tj/domain/documents";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
}: {
  slides: readonly { id: Id }[] | undefined;
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
    for (let i = slides.length - 1; i >= 0; i--) {
      const id = slides[i]?.id;
      if (id !== undefined && writingSlideIds.has(id)) return id;
    }
    return undefined;
  }, [slides, writingSlideIds]);
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
    mark.current = target;
    setActiveSlide(target);
  }, [activeSlideId, following, target, setActiveSlide]);

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
