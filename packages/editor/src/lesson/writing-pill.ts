import { useEffect, useRef, useState } from "react";

/**
 * The writing pill as one monotonic state machine (P1 26 Oct, jank audit #7): planning → writing
 * slide N of M (N and M never go back) → finishing → gone. Before, the pill's text was derived
 * afresh on every render from whichever draft streamed last, so it flapped: "Writing slide 1 of
 * 11" for 53 ms then "3 of 11", back to "Planning the slides…" between drafts, and gone whenever
 * the open slide was done.
 */
export type PillPhase = "planning" | "writing" | "finishing" | "gone";
export type PillState = {
  readonly phase: PillPhase;
  /** The furthest slide (1-based) the writer has been seen writing. */
  readonly slide: number;
  /** The most slides the lesson has had. */
  readonly of: number;
};
export type PillInput = {
  /** A job is writing the lesson (`writingSlideIds` is set). */
  active: boolean;
  /** The writer has finished; the job adds pictures and checks. */
  done: boolean;
  /** The slide streaming now (0-based), or -1 between drafts. */
  writingIndex: number;
  slideCount: number;
};

export const PILL_START: PillState = { phase: "planning", slide: 0, of: 0 };
const RANK: Record<PillPhase, number> = { planning: 0, writing: 1, finishing: 2, gone: 3 };

/** Pure: the pill after one look at the writer. Returns `state` itself when nothing changed. */
export function nextPill(state: PillState, input: PillInput): PillState {
  if (!input.active) return state.phase === "gone" ? state : { ...state, phase: "gone" };
  // A new job after the last one ended starts over.
  const from = state.phase === "gone" ? PILL_START : state;
  const seen: PillPhase = input.done
    ? "finishing"
    : input.writingIndex >= 0
      ? "writing"
      : "planning";
  const phase = RANK[seen] < RANK[from.phase] ? from.phase : seen;
  const slide =
    phase === "writing" && input.writingIndex >= 0
      ? Math.max(from.slide, input.writingIndex + 1)
      : from.slide;
  const of = Math.max(from.of, input.slideCount, slide);
  if (phase === state.phase && slide === state.slide && of === state.of) return state;
  return { phase, slide, of };
}

export const FINISHING_TEXT = "Adding pictures and final checks…";

/** What the pill says, or `null` when it is gone. */
export function pillText(state: PillState): string | null {
  switch (state.phase) {
    case "planning":
      // The thumbnails fill in as the plan arrives: the pill counts with them.
      return state.of > 2 ? `Planning slide ${state.of}…` : "Planning the slides…";
    case "writing":
      return `Writing slide ${state.slide} of ${state.of}…`;
    case "finishing":
      return FINISHING_TEXT;
    case "gone":
      return null;
  }
}

export const PILL_PACE = {
  /** A new text waits this long for a later one (slide 1 then 3 within 53 ms shows only 3). */
  settleMs: 250,
  /** Each text stays at least this long, so the pill never flickers. */
  dwellMs: 900,
  /** The pill fades out over this long at the hand-over, then unmounts. */
  fadeMs: 200,
};
export type PillPace = typeof PILL_PACE;

type Timer = (fn: () => void, ms: number) => () => void;
const TIMER: Timer = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};
const perfNow = () => performance.now();

/**
 * The pill as shown: the state machine's text, held `dwellMs` and settled `settleMs` between
 * changes. `text` stays (with `visible` false) for `fadeMs` after the job ends, so the pill fades
 * out rather than vanishing next to the editing toolbar.
 */
export function useWritingPill(
  input: PillInput,
  {
    pace = PILL_PACE,
    now = perfNow,
    timer = TIMER,
  }: { pace?: PillPace; now?: () => number; timer?: Timer } = {},
): { text: string | null; visible: boolean; state: PillState } {
  const [target, setTarget] = useState(() => nextPill(PILL_START, input));
  const next = nextPill(target, input);
  if (next !== target) setTarget(next);
  const [shown, setShown] = useState<{ text: string | null; visible: boolean }>(() => ({
    text: pillText(next),
    visible: next.phase !== "gone",
  }));
  // The first text dwells from the moment it shows, like every other.
  const lastAt = useRef<number | null>(null);
  if (lastAt.current === null) lastAt.current = now();
  const want = pillText(next);
  useEffect(() => {
    if (want === null) {
      if (!shown.visible) {
        if (shown.text === null) return;
        return timer(() => setShown({ text: null, visible: false }), pace.fadeMs);
      }
      setShown((s) => ({ text: s.text, visible: false }));
      return;
    }
    if (want === shown.text && shown.visible) return;
    const commit = () => {
      lastAt.current = now();
      setShown({ text: want, visible: true });
    };
    // The first text (and the first after a fade) shows at once.
    if (shown.text === null || !shown.visible) return commit();
    const due = Math.max(now() + pace.settleMs, (lastAt.current ?? 0) + pace.dwellMs);
    const wait = due - now();
    if (wait <= 0) return commit();
    return timer(commit, wait);
  }, [want, shown, pace, now, timer]);
  return { ...shown, state: next };
}

/**
 * `show`, held for `ms` after it turns false with `visible` false, so a control fades out instead
 * of vanishing (the "Follow writing" chip at the hand-over).
 */
export function useLinger(show: boolean, ms: number): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(show);
  if (show && !mounted) setMounted(true);
  useEffect(() => {
    if (show || !mounted) return;
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [show, mounted, ms]);
  return { mounted: show || (mounted && ms > 0), visible: show };
}
