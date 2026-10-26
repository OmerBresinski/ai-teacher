import type { Id } from "@tj/domain/documents";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPlannedBlank } from "./live-draft";

/**
 * Pacing (TEACH-202 part o, Greg 25 Oct: "it kinda skips through slides too fast"). The writer
 * drafts a slide about every 1.2 to 1.5 s, faster than its words can be read as they type out, so
 * the follow walks the deck one slide at a time: it leaves the open slide only once all its words
 * are on screen (`typedId`) and have stood `readMs`, and never before the slide has been open
 * `minMs`.
 */
export const FOLLOW_PACE = {
  readMs: 1200,
  minMs: 2000,
  /** The writer this many slides ahead: the follow reads faster (`catchUp*`) to catch up. */
  behind: 3,
  catchUpReadMs: 500,
  catchUpMinMs: 1000,
  /** This far behind (or on "Follow writing"), the follow goes straight to the slide being written. */
  jump: 5,
};
export type FollowPace = typeof FOLLOW_PACE;

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
  revealing,
  typedId,
  pace = FOLLOW_PACE,
  now = () => performance.now(),
}: {
  slides: readonly { id: Id; elements?: readonly unknown[] }[] | undefined;
  /**
   * Live writing (ADR 0039): the slide whose drafts are streaming now. The writer's later slides
   * wait as blank `writing` slides, so the newest writing slide is not the one being written.
   */
  lead?: Id;
  /** A new lesson's title or objectives slide typing out now (first-slides-reveal.ts). */
  revealing?: Id;
  writingSlideIds: ReadonlySet<Id> | undefined;
  activeSlideId: Id | null;
  setActiveSlide: (id: Id) => void;
  startFollowing: boolean;
  canvasFocused: boolean;
  /** The open slide, once every word it has is on screen (the typing has caught up). */
  typedId?: Id | undefined;
  pace?: FollowPace;
  now?: () => number;
}): {
  following: boolean;
  target: Id | undefined;
  resume: () => void;
  mark: { current: Id | null };
} {
  const [following, setFollowing] = useState(startFollowing);
  const target = useMemo(() => {
    if (!writingSlideIds || !slides) return undefined;
    // The writer goes in order, and its later slides wait as planned blanks. Once the writer is on
    // the content slides, the view stays on the last slide with something to show (its saved copy)
    // until the next slide's draft has words (`lead`, ready drafts only), so a slide's typing ends
    // on screen (TEACH-202 part f).
    const at = (id: Id | undefined) => slides.findIndex((s) => s.id === id);
    // Before then (Greg, 20 Oct 2026, amending part f): the title and objectives type out first,
    // then the view opens the next planned slide as an outline instead of holding on the
    // objectives for the writer's planning time. Real words from slide 3 on always lead, saved or
    // streaming: once a later slide has words, `lead` may be undefined between drafts and the view
    // must hold on the written slide, not jump to the next outline.
    const planning = slides.slice(2).every((s) => s.elements === undefined || isPlannedBlank(s));
    if (at(lead) < 2 && planning) {
      if (revealing !== undefined && writingSlideIds.has(revealing)) return revealing;
      const outline = slides.find(
        (s, i) =>
          i >= 2 && writingSlideIds.has(s.id) && s.elements !== undefined && isPlannedBlank(s),
      );
      if (outline) return outline.id;
    }
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
    if (lead !== undefined && at(lead) >= Math.max(0, at(shown))) return lead;
    return shown ?? first;
  }, [slides, writingSlideIds, lead, revealing]);
  /** The slide the follow is opening, until the session reports it open. */
  const mark = useRef<Id | null>(null);
  const previous = useRef(activeSlideId);
  /** When the open slide opened, and when its words were all on screen. */
  const opened = useRef({ id: activeSlideId, at: now() });
  const typed = useRef<{ id?: Id; at: number }>({ at: 0 });
  /** "Follow writing" was pressed: the next move goes straight to the slide being written. */
  const jump = useRef(false);
  const [, wake] = useState(0);
  if (opened.current.id !== activeSlideId) opened.current = { id: activeSlideId, at: now() };
  if (typedId !== typed.current.id) typed.current = { id: typedId, at: now() };

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
    const list = slides ?? [];
    const at = (id: Id | null) => list.findIndex((s) => s.id === id);
    const from = at(activeSlideId);
    const to = at(target);
    if (activeSlideId !== null && to < from) return;
    const behind = to - from;
    let next = target;
    if (from >= 0 && !jump.current && behind < pace.jump) {
      // One slide at a time, each read before the next: its words all shown, then a pause.
      const fast = behind >= pace.behind;
      const due = Math.max(
        opened.current.at + (fast ? pace.catchUpMinMs : pace.minMs),
        typed.current.id === activeSlideId
          ? typed.current.at + (fast ? pace.catchUpReadMs : pace.readMs)
          : Number.POSITIVE_INFINITY,
      );
      const wait = due - now();
      if (wait > 0) {
        if (!Number.isFinite(wait)) return;
        const t = setTimeout(() => wake((n) => n + 1), wait);
        return () => clearTimeout(t);
      }
      next = list[from + 1]?.id ?? target;
    }
    jump.current = false;
    mark.current = next;
    setActiveSlide(next);
  });

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

  const resume = useCallback(() => {
    jump.current = true;
    setFollowing(true);
  }, []);
  return { following, target, resume, mark };
}
