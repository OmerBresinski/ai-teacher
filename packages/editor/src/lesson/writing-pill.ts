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

/**
 * The slides the pill counts, in order: the lesson's own slides, never the Answers slides the job
 * adds after them (`answersRole`; genux review J9, TEACH-247 part au). They can land at any point in
 * the fill, so counting them would flip "Writing slide 11 of 14" to "of 18" and jump the planning
 * count by four.
 */
export function pillSlideIds(
  slides: readonly { id: string; answersRole?: unknown }[] | undefined,
): string[] {
  return (slides ?? []).filter((s) => !s.answersRole).map((s) => s.id);
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
  /**
   * A count that moved on by more than one (or any planning count) steps through every number at
   * this pace rather than skipping (Greg 26 Oct: the count went 8 → 10, 11 → 13).
   */
  stepMs: 220,
};
export type PillPace = typeof PILL_PACE;

const COUNT = /^(Planning slide|Writing slide) (\d+)(.*)$/;

/**
 * The next text to show on the way from `shown` to `want`: a count of the same kind moves one
 * number at a time (Planning slide 8 → 9 → 10, Writing slide 11 → 12 → 13), so it never skips a
 * slide. `step` is true when the move is one of several to catch up (or a planning count), which
 * goes at `stepMs` rather than the full dwell. Pure.
 */
export function stepText(shown: string | null, want: string): { text: string; step: boolean } {
  const b = want.match(COUNT);
  // "Planning the slides…" counts on from slide 3 (the title and objectives come first).
  const a = (shown === "Planning the slides…" ? "Planning slide 2…" : shown)?.match(COUNT);
  if (!a || !b || a[1] !== b[1]) return { text: want, step: false };
  const from = Number(a[2]);
  const to = Number(b[2]);
  if (to <= from) return { text: want, step: false };
  const planning = b[1] === "Planning slide";
  return { text: `${b[1]} ${from + 1}${b[3]}`, step: planning || to - from > 1 };
}

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
  const [mountedAt] = useState(now);
  const lastAt = useRef(mountedAt);
  const want = pillText(next, input.slideIds);
  useEffect(() => {
    if (want === null) {
      if (!shown.visible) {
        if (shown.text === null) return;
        return timer(() => setShown({ text: null, visible: false }), pace.fadeMs);
      }
      // The job's own end (from "finishing") fades out at the hand-over. A stop or a failure goes at
      // once: the stopped notice takes its place, and a half-faded pill is unreadable text.
      if (shown.text !== FINISHING_TEXT) {
        setShown({ text: null, visible: false });
        return;
      }
      setShown((s) => ({ text: s.text, visible: false }));
      return;
    }
    if (want === shown.text && shown.visible) return;
    // The first text (and the first after a fade) shows at once.
    const fresh = shown.text === null || !shown.visible;
    const next = fresh ? { text: want, step: false } : stepText(shown.text, want);
    const commit = () => {
      lastAt.current = now();
      setShown({ text: next.text, visible: true });
    };
    if (fresh) return commit();
    const due = next.step
      ? lastAt.current + pace.stepMs
      : Math.max(now() + pace.settleMs, lastAt.current + pace.dwellMs);
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
    if (ms <= 0) {
      setMounted(false);
      return;
    }
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [show, mounted, ms]);
  return { mounted: show || (mounted && ms > 0), visible: show };
}
