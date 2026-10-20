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
 *   slide already has words), and neither does reduced motion.
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

type Part = { id: Id; words: number; from: number; to: number };

export type FirstSlidesReveal = {
  /** Words of `slideId` to show now; undefined when the slide is not being revealed (show it all). */
  words: (slideId: Id | undefined) => number | undefined;
  /** The slide the reveal is typing now, undefined when none. */
  current: () => Id | undefined;
  subscribe: (fn: () => void) => () => void;
  /**
   * Plans the reveal once (later calls do nothing); safe during render: it neither notifies nor
   * starts the clock. `start` does both, from an effect.
   */
  arm: (slides: readonly { id: Id; words: number }[], now?: number) => void;
  start: () => void;
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
  let parts: Part[] = [];
  let state: "idle" | "running" | "done" = "idle";
  let shown = new Map<Id, number>();
  let currentId: Id | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let rushed: { at: number; from: Map<Id, number> } | undefined;
  const subs = new Set<() => void>();
  const notify = () => {
    for (const fn of subs) fn();
  };
  const finish = (quiet = false) => {
    state = "done";
    shown = new Map();
    currentId = undefined;
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
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
        const from = rushed.from.get(p.id) ?? 0;
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
    if (!left) return finish(quiet);
    let changed = cur !== currentId;
    for (const [id, n] of next) if (shown.get(id) !== n) changed = true;
    shown = next;
    currentId = cur;
    if (changed && !quiet) notify();
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
      const real = slides.filter((s) => s.words > 0);
      if (real.length === 0) return finish(true);
      // The title slide gets a quarter of the time, the objectives the rest; one slide gets it all.
      const spans =
        real.length === 1
          ? [1]
          : [TITLE_SHARE, ...real.slice(1).map(() => (1 - TITLE_SHARE) / (real.length - 1))];
      let at = now;
      parts = real.map((s, i) => {
        const to = at + FIRST_SLIDES_REVEAL_MS * (spans[i] ?? 0);
        const p = { id: s.id, words: s.words, from: at, to };
        at = to;
        return p;
      });
      state = "running";
      tick(now, true);
    },
    start: () => {
      if (state !== "running" || timer !== undefined) return;
      timer = setInterval(() => tick(), TICK_MS);
      notify();
      tick();
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

/**
 * The editor's reveal of a new lesson's first two slides. Arms once, the first time the editor
 * sees the job writing with slides 1-2 holding words and every later slide still an empty plan;
 * otherwise (a lesson reopened mid-run or after it, reduced motion) it never runs. `leadIndex` is
 * the deck position of the slide whose draft has words: from slide 3 on it rushes the reveal.
 */
export function useFirstSlidesReveal({
  slides,
  writingSlideIds,
  leadIndex,
}: {
  slides: readonly Slide[] | undefined;
  writingSlideIds: ReadonlySet<Id> | undefined;
  leadIndex: number;
}): FirstSlidesReveal {
  const [reveal] = useState(() => createFirstSlidesReveal());
  const writing = writingSlideIds !== undefined;
  // Decided during render, once, so the follow sees the reveal on the same render as the slides
  // (else it would open slide 3's outline first and never come back). Neither branch notifies.
  if (reveal.state() === "idle" && slides && writingSlideIds) {
    const later = slides.slice(2);
    const fresh =
      leadIndex < 2 && later.every((s) => writingSlideIds.has(s.id) && isPlannedBlank(s));
    if (!fresh || prefersReduced()) reveal.stop(true);
    else
      reveal.arm(
        slides
          .slice(0, 2)
          .filter((s) => writingSlideIds.has(s.id) && !isPlannedBlank(s))
          .map((s) => ({ id: s.id, words: wordCount(s) })),
      );
  }
  const running = reveal.state() === "running";
  useEffect(() => {
    if (running) reveal.start();
  }, [reveal, running]);
  useEffect(() => {
    if (leadIndex >= 2) reveal.rush();
  }, [reveal, leadIndex]);
  // The job ended (or this editor never wrote): the whole slides show.
  useEffect(() => {
    if (!writing && reveal.state() === "running") reveal.stop();
  }, [reveal, writing]);
  // No stop on unmount: StrictMode's second mount would never reveal; the clock ends by itself.
  return reveal;
}
