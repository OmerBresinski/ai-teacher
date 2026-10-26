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
  /**
   * The furthest slide the writer has been seen writing, by id, so its number stays right when the
   * teacher deletes or moves a slide before it.
   */
  readonly slideId: string | undefined;
};
export type PillInput = {
  /** A job is writing the lesson (`writingSlideIds` is set). */
  active: boolean;
  /** The writer has finished; the job adds pictures and checks. */
  done: boolean;
  /** The slide streaming now, or undefined between drafts. */
  writingId: string | undefined;
  /** The lesson's slides in order, as they are now. */
  slideIds: readonly string[];
};

export const PILL_START: PillState = { phase: "planning", slideId: undefined };
const RANK: Record<PillPhase, number> = { planning: 0, writing: 1, finishing: 2, gone: 3 };

/** Pure: the pill after one look at the writer. Returns `state` itself when nothing changed. */
export function nextPill(state: PillState, input: PillInput): PillState {
  if (!input.active) return state.phase === "gone" ? state : { ...state, phase: "gone" };
  // A new job after the last one ended starts over.
  const from = state.phase === "gone" ? PILL_START : state;
  const writing = input.writingId !== undefined && input.slideIds.includes(input.writingId);
  const seen: PillPhase = input.done ? "finishing" : writing ? "writing" : "planning";
  const phase = RANK[seen] < RANK[from.phase] ? from.phase : seen;
  // The writer goes in deck order: a draft of a slide before the furthest one is a late one.
  const at = (id: string | undefined) => (id === undefined ? -1 : input.slideIds.indexOf(id));
  const slideId =
    phase === "writing" && writing && at(input.writingId) >= at(from.slideId)
      ? input.writingId
      : from.slideId;
  if (phase === state.phase && slideId === state.slideId) return state;
  return { phase, slideId };
}

export const FINISHING_TEXT = "Adding pictures and final checks…";

/** What the pill says, or `null` when it is gone. Numbers are read from the deck as it is now. */
export function pillText(state: PillState, slideIds: readonly string[]): string | null {
  const of = slideIds.length;
  switch (state.phase) {
    case "planning":
      // The thumbnails fill in as the plan arrives: the pill counts with them.
      return of > 2 ? `Planning slide ${of}…` : "Planning the slides…";
    case "writing": {
      const n = state.slideId === undefined ? -1 : slideIds.indexOf(state.slideId);
      // The slide was deleted: say what the writer is doing without a number.
      return n < 0 ? "Writing the slides…" : `Writing slide ${n + 1} of ${of}…`;
    }
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
    text: pillText(next, input.slideIds),
    visible: next.phase !== "gone",
  }));
  // The first text dwells from the moment it shows, like every other.
  const lastAt = useRef<number | null>(null);
  if (lastAt.current === null) lastAt.current = now();
  const want = pillText(next, input.slideIds);
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
