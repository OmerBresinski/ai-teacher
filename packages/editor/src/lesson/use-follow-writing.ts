import type { Id } from "@tj/domain/documents";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live writing P1 (TEACH-202 part e): while a job writes the lesson, the open slide follows the
 * slide being written (the last `writing` slide in deck order: the writer goes in order, and the
 * objectives slide stays `writing` until the job ends). The
 * teacher takes over by opening another slide (a thumb, an arrow key, a residual, an insert) or by
 * focusing the canvas of a done slide to edit it; from then the open slide stays put. `resume`
 * (the "Follow writing" chip) follows again, as does opening the slide being written. This is the
 * generating shell's "Newest slide" behaviour (TEACH-252) carried into the editor; the shell's
 * pick arrives as `startFollowing` (`initialSlideId` absent: the shell was following).
 *
 * The follow only sets the session's active slide: it never moves focus or scrolls the strip.
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
}): { following: boolean; target: Id | undefined; resume: () => void } {
  const [following, setFollowing] = useState(startFollowing);
  const target = writingSlideIds
    ? [...(slides ?? [])].reverse().find((s) => writingSlideIds.has(s.id))?.id
    : undefined;
  /** The slide the follow itself last opened, so the teacher's own moves can be told apart. */
  const own = useRef<Id | null>(null);
  const previous = useRef(activeSlideId);

  useEffect(() => {
    const moved = activeSlideId !== previous.current;
    previous.current = activeSlideId;
    if (moved && activeSlideId !== own.current) {
      // The teacher opened a slide: back to the slide being written follows again, any other pins.
      const back = activeSlideId !== null && activeSlideId === target;
      if (back !== following) setFollowing(back);
      return;
    }
    if (!following || !target || target === activeSlideId) return;
    own.current = target;
    setActiveSlide(target);
  }, [activeSlideId, following, target, setActiveSlide]);

  // Focus on the canvas is an edit starting; a writing slide's canvas is inert, so this is a done one.
  useEffect(() => {
    if (canvasFocused && writingSlideIds) setFollowing(false);
  }, [canvasFocused, writingSlideIds]);

  const resume = useCallback(() => setFollowing(true), []);
  return { following, target, resume };
}
