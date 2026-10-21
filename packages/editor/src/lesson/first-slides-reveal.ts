/*
 * First-generation pacing (Greg, 20 Oct 2026; UX ruling amending TEACH-202 part f): while a new
 * lesson is written, its title and objectives slides type themselves out over about twelve seconds
 * (title, then subtitle, then each objective) instead of appearing whole, so the lesson looks alive
 * while the writer plans the rest.
 *
 * Presentation only. The reveal reads the saved slides and cuts their words for display (the same
 * `revealSlide` the live drafts use); it never touches the document, a save, the follow's progress
 * past slide 2 or anything the teacher can edit:
 * - a later slide with words of its own (the writer's first content slide) finishes it at once
 *   (`rush`, well under a second), and the view moves on without waiting for it;
 * - it runs only while the job still owns the slide; a slide handed over, or the job ending, shows
 *   the whole slide;
 * - a lesson opened after its slides were written never arms it (no writing slides, or a later
 *   slide already has words), and neither does reduced motion;
 * - it plays once per lesson per browser tab: a reload or a return to the lesson mid-plan shows the
 *   slides whole (a sessionStorage flag set when it arms).
 */
import type { Id, Slide } from "@tj/domain/documents";
import { useEffect, useState, useSyncExternalStore } from "react";
import { isPlannedBlank, wordCount } from "./live-draft";

/** How long the title and objectives slides take to type out on a new lesson. */
export const FIRST_SLIDES_REVEAL_MS = 12_000;
/** The title slide's share of the reveal: its few words, then the objectives take the rest. */
const TITLE_SHARE = 0.25;
/** How long a rushed reveal takes to finish once real content is ahead of it. */
const RUSH_MS = 500;
/** How often the reveal looks at the clock (a word change notifies; most ticks change nothing). */
const TICK_MS = 50;

/** One of the first two slides: its deck position (0 or 1), live word count and typing window. */
type Part = { id: Id; words: number; from: number; to: number };
/** Slides 1-2 as the editor sees them now; `words` 0 while a slide is blank or absent. */
export type RevealSlide = { id: Id; words: number };

export type FirstSlidesReveal = {
  /** Words of `slideId` to show now; undefined when the slide is not being revealed (show it all). */
  words: (slideId: Id | undefined) => number | undefined;
  /** The slide the reveal is typing now, undefined when none. */
  current: () => Id | undefined;
  subscribe: (fn: () => void) => () => void;
  /**
   * Plans the reveal over slides 1-2 (deck order; later calls do nothing). Safe during render: it
   * neither notifies nor starts the clock. A slide still blank waits for `sync`.
   */
  arm: (slides: readonly (RevealSlide | undefined)[], now?: number) => void;
  /**
   * Slides 1-2's live word counts (safe during render, never notifies): a slide that first gets
   * words inside the window is paced from then to the window's end; one that changes keeps its
   * place in its window with the new count.
   */
  sync: (slides: readonly (RevealSlide | undefined)[], now?: number) => void;
  /**
   * Runs the clock while at least one holder keeps it (an effect's mount); the returned release
   * pauses it when the last holder lets go (unmount), so no interval outlives the editor. StrictMode's
   * second mount simply retains it again.
   */
  retain: () => () => void;
  /** Real content is ahead: finish within `RUSH_MS`. */
  rush: (now?: number) => void;
  /** Never reveal on this editor (reopened, reduced motion, or done): shows everything. */
  stop: (quiet?: boolean) => void;
  /** "idle" until armed or stopped. */
  state: () => "idle" | "running" | "done";
};

export function createFirstSlidesReveal(
  clock: () => number = () => performance.now(),
): FirstSlidesReveal {
  const parts: Part[] = [];
  let state: "idle" | "running" | "done" = "idle";
  let shown = new Map<Id, number>();
  let currentId: Id | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let holders = 0;
  let rushed: { at: number; from: Map<Id, number> } | undefined;
  /** The window's start; a slide's window is [slot start, slot end] from here. */
  let t0 = 0;
  const slot = (pos: number) =>
    pos === 0
      ? [t0, t0 + FIRST_SLIDES_REVEAL_MS * TITLE_SHARE]
      : [t0 + FIRST_SLIDES_REVEAL_MS * TITLE_SHARE, t0 + FIRST_SLIDES_REVEAL_MS];
  const subs = new Set<() => void>();
  const notify = () => {
    for (const fn of subs) fn();
  };
  const pause = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const finish = (quiet = false) => {
    state = "done";
    shown = new Map();
    currentId = undefined;
    pause();
    if (!quiet) notify();
  };
  const tick = (now = clock(), quiet = false) => {
    if (state !== "running") return;
    const next = new Map<Id, number>();
    let cur: Id | undefined;
    let left = false;
    for (const p of parts) {
      let n: number;
      if (rushed) {
        const k = Math.min(1, (now - rushed.at) / RUSH_MS);
        const from = Math.min(p.words, rushed.from.get(p.id) ?? 0);
        n = Math.round(from + (p.words - from) * k);
      } else {
        const k = Math.max(0, Math.min(1, (now - p.from) / Math.max(1, p.to - p.from)));
        // The first word shows as the slide's turn starts, so the slide never looks empty.
        n = now < p.from ? 0 : Math.max(1, Math.ceil(p.words * k));
      }
      n = Math.min(p.words, n);
      next.set(p.id, n);
      if (n < p.words) {
        left = true;
        if (cur === undefined && now >= p.from) cur = p.id;
      }
    }
    // Slide 2 may still arrive inside the window (only slide 1 had words): keep watching for it.
    const waiting = !rushed && parts.length < 2 && now < t0 + FIRST_SLIDES_REVEAL_MS;
    if (!left && !waiting) return finish(quiet);
    let changed = cur !== currentId;
    for (const [id, n] of next) if (shown.get(id) !== n) changed = true;
    shown = next;
    currentId = cur;
    if (changed && !quiet) notify();
  };
  const sync = (slides: readonly (RevealSlide | undefined)[], now = clock()) => {
    if (state !== "running") return;
    let added = false;
    for (const [pos, s] of slides.slice(0, 2).entries()) {
      if (!s) continue;
      const p = parts.find((q) => q.id === s.id);
      if (p) {
        p.words = s.words;
        continue;
      }
      // A slide that first gets words: paced from now to its window's end, if the window is open
      // and the reveal is not already rushing; else it shows whole.
      const [from, to] = slot(pos) as [number, number];
      if (s.words <= 0 || rushed || now >= to) continue;
      parts.push({ id: s.id, words: s.words, from: Math.max(from, now), to });
      parts.sort((a, b) => a.from - b.from);
      added = true;
    }
    // Quietly, so the render that brings the new words already shows them cut.
    if (added) tick(now, true);
  };
  return {
    words: (id) => (state === "running" && id !== undefined ? shown.get(id) : undefined),
    current: () => (state === "running" ? currentId : undefined),
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    arm: (slides, now = clock()) => {
      if (state !== "idle") return;
      const first = slides[0];
      if (!slides.slice(0, 2).some((s) => s && s.words > 0)) return;
      // The title starts the window; with only the objectives worded, they start at their turn now.
      t0 = first && first.words > 0 ? now : now - FIRST_SLIDES_REVEAL_MS * TITLE_SHARE;
      state = "running";
      sync(slides, now);
    },
    sync,
    retain: () => {
      holders += 1;
      if (state === "running" && timer === undefined) {
        timer = setInterval(() => tick(), TICK_MS);
        notify();
        tick();
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0) pause();
      };
    },
    rush: (now = clock()) => {
      if (state !== "running" || rushed) return;
      rushed = { at: now, from: new Map(shown) };
      tick(now);
    },
    stop: (quiet = false) => {
      if (state === "done") return;
      finish(quiet);
    },
    state: () => state,
  };
}

const NO_SUBSCRIBE = () => () => {};

/** The words of `slideId` the reveal shows now (undefined: the whole slide). */
export function useRevealWords(
  reveal: FirstSlidesReveal | undefined,
  slideId: Id | undefined,
): number | undefined {
  return useSyncExternalStore(
    reveal?.subscribe ?? NO_SUBSCRIBE,
    () => reveal?.words(slideId),
    () => undefined,
  );
}

/** The slide the reveal is typing now; re-renders only when it moves on. */
export function useRevealCurrent(reveal: FirstSlidesReveal | undefined): Id | undefined {
  return useSyncExternalStore(
    reveal?.subscribe ?? NO_SUBSCRIBE,
    () => reveal?.current(),
    () => undefined,
  );
}

const REDUCED = "(prefers-reduced-motion: reduce)";
const prefersReduced = () =>
  typeof window !== "undefined" && !!window.matchMedia?.(REDUCED).matches;

/** The sessionStorage key that marks a lesson's reveal as played in this tab. */
export const revealedKey = (lessonId: string) => `tj:first-slides-revealed:${lessonId}`;
const revealedBefore = (lessonId: string | undefined) => {
  if (!lessonId) return false;
  try {
    return window.sessionStorage.getItem(revealedKey(lessonId)) !== null;
  } catch {
    return false;
  }
};
const markRevealed = (lessonId: string | undefined) => {
  if (!lessonId) return;
  try {
    window.sessionStorage.setItem(revealedKey(lessonId), "1");
  } catch {
    // Storage blocked: a reload may replay the reveal; nothing else depends on it.
  }
};

/**
 * The editor's reveal of a new lesson's first two slides. Arms once, the first time the editor
 * sees the job writing with slide 1 or 2 holding words and every later slide still an empty plan,
 * unless this tab already played it for the lesson; otherwise (a lesson reopened after slide 3 has
 * words, a reload, reduced motion) it never runs. `leadIndex` is the deck position of the slide
 * whose draft has words: from slide 3 on it rushes the reveal.
 */
export function useFirstSlidesReveal({
  lessonId,
  slides,
  writingSlideIds,
  leadIndex,
}: {
  lessonId?: string;
  slides: readonly Slide[] | undefined;
  writingSlideIds: ReadonlySet<Id> | undefined;
  leadIndex: number;
}): FirstSlidesReveal {
  const [reveal] = useState(() => createFirstSlidesReveal());
  const writing = writingSlideIds !== undefined;
  // Slides 1-2 the job still owns, with their live word counts (0 while blank).
  const firstTwo =
    slides && writingSlideIds
      ? slides
          .slice(0, 2)
          .map((s) =>
            writingSlideIds.has(s.id)
              ? { id: s.id, words: isPlannedBlank(s) ? 0 : wordCount(s) }
              : undefined,
          )
      : [];
  // Decided during render, so the follow sees the reveal on the same render as the slides (else it
  // would open slide 3's outline first and never come back). Nothing here notifies.
  if (reveal.state() === "idle" && slides && writingSlideIds) {
    const later = slides.slice(2);
    const fresh =
      leadIndex < 2 && later.every((s) => writingSlideIds.has(s.id) && isPlannedBlank(s));
    if (!fresh || prefersReduced() || revealedBefore(lessonId)) reveal.stop(true);
    else if (firstTwo.some((s) => s && s.words > 0)) {
      reveal.arm(firstTwo);
      markRevealed(lessonId);
    }
    // Slides 1-2 still blank: wait (idle) until they get words.
  } else reveal.sync(firstTwo);
  const running = reveal.state() === "running";
  // The clock runs while this editor is mounted, and pauses on unmount (StrictMode re-retains).
  useEffect(() => (running ? reveal.retain() : undefined), [reveal, running]);
  useEffect(() => {
    if (leadIndex >= 2) reveal.rush();
  }, [reveal, leadIndex]);
  // The job ended (or this editor never wrote): the whole slides show.
  useEffect(() => {
    if (!writing && reveal.state() === "running") reveal.stop();
  }, [reveal, writing]);
  return reveal;
}
