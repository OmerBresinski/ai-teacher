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
  /**
   * Never less than about 800 ms after a slide visibly finishes, however far behind (Greg 26 Oct:
   * one slide was left 0.1 s after its last word, others 0.7 s). The typing speeds up instead.
   */
  catchUpReadMs: 800,
  catchUpMinMs: 1000,
  /** This far behind (or on "Follow writing"), the follow goes straight to the slide being written. */
  jump: 5,
  /**
   * A slide that never reports its words typed out (a view that cannot tell) is left anyway this
   * long after the writer moved past it, or this long after it opened, whichever comes first.
   */
  maxAfterTextMs: 6000,
  maxOpenMs: 8000,
  /**
   * A slide that reported its words typed and is typing again is left at the latest this long after
   * the writer moved past it, even if it never reports them typed again (the follow never stalls).
   */
  stallMs: 6000,
};
export type FollowPace = typeof FOLLOW_PACE;

/**
 * What the view shows while the writer plans (before the first content slide has words).
 * - `"outline"` (UX ruling 278, Greg 20 Oct, amending part f): the title and objectives type out,
 *   then the view opens the next planned slide as its outline.
 * - `"stay"` (proposed 26 Oct, pending Greg): the view stays on the last finished slide.
 * Switch here; nothing else depends on the choice.
 */
export const PLANNING_VIEW: "outline" | "stay" = "outline";

/** The slide to hold on while the writer plans, or undefined to use the usual target. */
export function planningView(
  slides: readonly { id: Id; elements?: readonly unknown[] }[],
  writingSlideIds: ReadonlySet<Id>,
  revealing: Id | undefined,
  view: "outline" | "stay" = PLANNING_VIEW,
): Id | undefined {
  if (revealing !== undefined && writingSlideIds.has(revealing)) return revealing;
  if (view === "stay") return undefined;
  return slides.find(
    (s, i) => i >= 2 && writingSlideIds.has(s.id) && s.elements !== undefined && isPlannedBlank(s),
  )?.id;
}

/**
 * Live writing P1 (TEACH-202 part e): while a job writes the lesson, the open slide follows the
 * slide being written (the last `writing` slide in deck order: the writer goes in order, and the
 * objectives slide stays `writing` until the job ends). The shell's pick arrives as
 * `startFollowing` (`initialSlideId` absent: the shell was following).
 *
 * Any change of the open slide the follow did not make stops it for good: the strip, the toolbar,
 * undo, search, Present, a screen reader's activation, focus onto a thumbnail. On top of that, the
 * teacher's own gestures stop it before any move (`isTeacherNavigation`: a click or movement key on
 * a slide, thumbnail or the canvas, a wheel or touch scroll in the strip), and so does focus on a
 * done slide's canvas. Clicks and keys elsewhere (the top bar, the Theme dialog, P0 26 Oct: opening
 * Theme mid-generation used to stop it through a document-wide pointer listener) do not.
 * Only the "Follow writing" chip (`resume`) starts it again. The follow sets the session's active slide and marks
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
  now = perfNow,
  timer = TIMER,
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
  /** Schedules the next look (tests pass their own clock, not global fake timers). */
  timer?: FollowTimer;
}): {
  following: boolean;
  target: Id | undefined;
  resume: () => void;
  /** The teacher opened a slide by a route the events cannot see (a link in a side pane). */
  stop: () => void;
  mark: { current: Id | null };
  /** Slides between the open slide and the one being written (0 when level or not following). */
  behind: number;
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
      const held = planningView(slides, writingSlideIds, revealing);
      if (held !== undefined) return held;
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
  /**
   * When the open slide opened, when its words were all on screen, and when the writer moved past
   * it (its words complete in the document). Set in effects declared before the follow's own, so
   * they are current when it runs.
   */
  const opened = useRef<{ id: Id | null; at: number }>({ id: null, at: 0 });
  const typed = useRef<{ id?: Id; at: number }>({ at: 0 });
  /** Slides that have reported their words typed out at least once: this view can tell. */
  const tells = useRef(new Set<Id>());
  const passed = useRef<{ id: Id | null; at: number } | null>(null);
  /** "Follow writing" was pressed: the next move goes straight to the slide being written. */
  const jump = useRef(false);
  const [, wake] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: stamps the time the open slide changed; `now` is a clock.
  useEffect(() => {
    opened.current = { id: activeSlideId, at: now() };
    passed.current = null;
  }, [activeSlideId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: stamps the time the typing caught up; `now` is a clock.
  useEffect(() => {
    typed.current = { id: typedId, at: now() };
    if (typedId !== undefined) tells.current.add(typedId);
  }, [typedId]);

  useEffect(() => {
    const moved = activeSlideId !== previous.current;
    previous.current = activeSlideId;
    if (moved) {
      const own = activeSlideId !== null && activeSlideId === mark.current;
      if (!own) {
        // The teacher opened a slide, by whatever route: the follow stops until the chip.
        mark.current = null;
        setFollowing(false);
        return;
      }
    }
    if (!following || !target || target === activeSlideId) {
      // Nothing to move to: a "Follow writing" press is spent, not saved for a later slide.
      jump.current = false;
      return;
    }
    // Forward only: the follow never takes the view back to an earlier slide.
    const list = slides ?? [];
    const at = (id: Id | null) => list.findIndex((s) => s.id === id);
    const from = at(activeSlideId);
    const to = at(target);
    if (activeSlideId !== null && to < from) return;
    const behind = to - from;
    let next = target;
    if (from >= 0 && !jump.current) {
      // One slide at a time, each read before the next: its words all shown, then a pause. A
      // slide that reports its typing is never left before its words are out and have stood the
      // read time (the give-up is only for a view that cannot tell); far behind, the follow jumps,
      // but still only once the open slide has been read.
      const fast = behind >= pace.behind;
      if (passed.current?.id !== activeSlideId) passed.current = { id: activeSlideId, at: now() };
      const tells_ = activeSlideId !== null && tells.current.has(activeSlideId);
      const read =
        typed.current.id === activeSlideId
          ? typed.current.at + (fast ? pace.catchUpReadMs : pace.readMs)
          : tells_
            ? // Typing again: the report wakes the follow (a re-render); the cap is a safety net.
              passed.current.at + pace.stallMs
            : Math.min(opened.current.at + pace.maxOpenMs, passed.current.at + pace.maxAfterTextMs);
      const due = Math.max(opened.current.at + (fast ? pace.catchUpMinMs : pace.minMs), read);
      const wait = due - now();
      // Never an unbounded wait: a browser runs `setTimeout(fn, Infinity)` at once, a render loop.
      if (wait > 0 && Number.isFinite(wait)) {
        const cancel = timer(() => wake((n) => n + 1), wait);
        return cancel;
      }
      next = behind >= pace.jump ? target : (list[from + 1]?.id ?? target);
    }
    jump.current = false;
    mark.current = next;
    setActiveSlide(next);
  });

  // The teacher's navigation: a click, tap or key on a slide or thumbnail, a scroll in the strip.
  const writing = writingSlideIds !== undefined;
  useEffect(() => {
    if (!following || !writing) return;
    const act = (e: Event) => {
      if (isTeacherNavigation(e)) setFollowing(false);
    };
    const events = ["pointerdown", "keydown", "wheel", "touchmove"] as const;
    for (const type of events)
      document.addEventListener(type, act, { capture: true, passive: true });
    return () => {
      for (const type of events) document.removeEventListener(type, act, { capture: true });
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
  const stop = useCallback(() => setFollowing(false), []);
  const behind = useMemo(() => {
    if (!following || !slides || !target) return 0;
    const to = slides.findIndex((s) => s.id === target);
    const from = slides.findIndex((s) => s.id === activeSlideId);
    return from < 0 || to < 0 ? 0 : Math.max(0, to - from);
  }, [following, slides, target, activeSlideId]);
  return { following, target, resume, stop, mark, behind };
}

const perfNow = () => performance.now();

/** Where the teacher's own navigation happens: the slide strip (or phone list) and the canvas. */
const NAVIGATION = "[data-navigator], [data-mobile-lesson-list], [data-slide-frame]";
/** Keys that move between slides or start an edit; a modifier chord (⌘+, ⌘0) is neither. */
const MOVE_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Enter",
  " ",
]);

/**
 * Whether an event is the teacher navigating between slides (P0 26 Oct): a pointer down or a
 * movement key on a slide or thumbnail, or a wheel or touch scroll in the slide strip. The top bar,
 * dialogs (Theme), side panes and the "Follow writing" chip are not.
 */
export function isTeacherNavigation(e: Event): boolean {
  const target = e.target;
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-follow-writing], [data-navigator-toggle], [role=dialog]")) return false;
  const zone = target.closest(NAVIGATION);
  if (!zone) return false;
  switch (e.type) {
    case "pointerdown":
      return true;
    case "keydown": {
      const k = e as KeyboardEvent;
      return !k.metaKey && !k.ctrlKey && !k.altKey && MOVE_KEYS.has(k.key);
    }
    case "wheel":
    case "touchmove":
      // Only the strip scrolls; a wheel over the canvas is zoom or nothing.
      return !zone.matches("[data-slide-frame]");
    default:
      return false;
  }
}

/** Runs `fn` after `ms`; returns a cancel. */
export type FollowTimer = (fn: () => void, ms: number) => () => void;
const TIMER: FollowTimer = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};
