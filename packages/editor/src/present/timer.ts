/*
 * The present-mode timer: state shape, transitions and derived values. Pure — every function takes
 * `now` — so the reducer, the readout and the tests share one clock model. Behavioural reference:
 * TeachDeck `lib/present/present-store.ts` (`TimerState` :18-47, timer actions :239-338, derived
 * values :385-423).
 */

export type TimerMode = "countdown" | "elapsed";

export type TimerState = {
  mode: TimerMode;
  /** Countdown target. */
  durationMs: number;
  /** Countdown: wall-clock moment it reaches zero. Null unless counting down. */
  endsAt: number | null;
  /** Elapsed: wall-clock moment the current run began. Null unless counting up. */
  startedAt: number | null;
  /** Countdown: what was left when it was paused. Null unless paused. */
  pausedRemainingMs: number | null;
  /** Elapsed: time banked by earlier runs. */
  elapsedBeforeMs: number;
  running: boolean;
  /** Started at least once this session, so the stage shows the readout. */
  armed: boolean;
};

export const TIMER_PRESETS_MS = [60_000, 120_000, 300_000, 600_000] as const;
export const DEFAULT_TIMER_DURATION = 300_000;

export const freshTimer = (
  mode: TimerMode = "countdown",
  durationMs = DEFAULT_TIMER_DURATION,
): TimerState => ({
  mode,
  durationMs,
  endsAt: null,
  startedAt: null,
  pausedRemainingMs: null,
  elapsedBeforeMs: 0,
  running: false,
  armed: false,
});

/* ------------------------------------------------------------------ */
/* Derived values                                                      */
/* ------------------------------------------------------------------ */

export function timerRemainingMs(t: TimerState, now: number): number {
  if (t.running && t.endsAt != null) return Math.max(0, t.endsAt - now);
  if (t.pausedRemainingMs != null) return t.pausedRemainingMs;
  return t.durationMs;
}

export function timerElapsedMs(t: TimerState, now: number): number {
  if (t.mode === "countdown") return t.durationMs - timerRemainingMs(t, now);
  return t.elapsedBeforeMs + (t.running && t.startedAt != null ? now - t.startedAt : 0);
}

/** True while the readout actually changes: a finished countdown stops ticking. */
export function timerTicking(t: TimerState, at: number = Date.now()): boolean {
  if (!t.running) return false;
  if (t.mode === "elapsed") return true;
  return (t.endsAt ?? 0) > at;
}

/** A countdown that has run out and not been cleared. */
export function timerFinished(t: TimerState, now: number = Date.now()): boolean {
  return t.armed && t.mode === "countdown" && timerRemainingMs(t, now) <= 0;
}

/** How much of the countdown is left, 0–1. Count-up has no end, so it reads full. */
export function timerFraction(t: TimerState, now: number): number {
  if (t.mode === "elapsed") return 1;
  if (t.durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, timerRemainingMs(t, now) / t.durationMs));
}

/** Amber at 20% left, red at zero — SPEC §8. */
export function timerFaceState(
  t: TimerState,
  now: number,
): "idle" | "running" | "warning" | "done" {
  if (!t.armed) return "idle";
  if (t.mode === "elapsed") return t.running ? "running" : "idle";
  const left = timerRemainingMs(t, now);
  if (left <= 0) return "done";
  if (left <= t.durationMs * 0.2) return "warning";
  return t.running ? "running" : "idle";
}

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

/**
 * Switching mode carries the time already spent across rather than throwing a running timer
 * away, so a teacher who taps the wrong mode two minutes into a task can tap back and be where
 * they were.
 */
export function setTimerMode(t: TimerState, mode: TimerMode, at: number): TimerState {
  if (t.mode === mode) return t;
  if (!t.armed) return freshTimer(mode, t.durationMs);
  const spent = timerElapsedMs(t, at);
  if (mode === "elapsed") {
    return {
      ...freshTimer("elapsed", t.durationMs),
      elapsedBeforeMs: spent,
      startedAt: t.running ? at : null,
      running: t.running,
      armed: true,
    };
  }
  const left = Math.max(0, t.durationMs - spent);
  return {
    ...freshTimer("countdown", t.durationMs),
    endsAt: t.running ? at + left : null,
    pausedRemainingMs: t.running ? null : left,
    running: t.running,
    armed: true,
  };
}

/**
 * `running` stays true on a countdown that has reached zero — it is finished, not stopped — so the
 * guard is "is the readout still moving", not the flag. Retyping the minutes on a finished clock is
 * exactly what "Start again" is for, and it has to take.
 */
export function setTimerDuration(t: TimerState, ms: number, at: number): TimerState {
  return timerTicking(t, at)
    ? t
    : { ...t, durationMs: Math.max(1000, ms), pausedRemainingMs: null };
}

export function startTimer(t: TimerState, at: number, ms?: number): TimerState {
  const duration = Math.max(1000, ms ?? t.durationMs);
  return t.mode === "countdown"
    ? {
        ...t,
        durationMs: duration,
        endsAt: at + duration,
        startedAt: null,
        pausedRemainingMs: null,
        running: true,
        armed: true,
      }
    : {
        ...t,
        startedAt: at,
        endsAt: null,
        elapsedBeforeMs: 0,
        pausedRemainingMs: null,
        running: true,
        armed: true,
      };
}

export function pauseTimer(t: TimerState, at: number): TimerState {
  // A countdown that has already run out has nothing left to pause: it is over, and the only
  // things offered are Start again and Clear.
  if (!timerTicking(t, at)) return t;
  return t.mode === "countdown"
    ? { ...t, running: false, pausedRemainingMs: Math.max(0, (t.endsAt ?? at) - at), endsAt: null }
    : {
        ...t,
        running: false,
        elapsedBeforeMs: t.elapsedBeforeMs + (at - (t.startedAt ?? at)),
        startedAt: null,
      };
}

export function resumeTimer(t: TimerState, at: number): TimerState {
  if (t.running || !t.armed) return t;
  return t.mode === "countdown"
    ? {
        ...t,
        running: true,
        endsAt: at + (t.pausedRemainingMs ?? t.durationMs),
        pausedRemainingMs: null,
      }
    : { ...t, running: true, startedAt: at };
}

/**
 * Reset puts the clock back to the top and stops it; it does not take the timer off the stage.
 * That is Clear, and the two are separate rows in the pill's menu because a teacher resetting
 * between two groups wants the pill to stay exactly where it is.
 */
export const resetTimer = (t: TimerState): TimerState => ({
  ...freshTimer(t.mode, t.durationMs),
  armed: t.armed,
});

/** Disarms it: the top-right pill goes with it. */
export const clearTimer = (t: TimerState): TimerState => freshTimer(t.mode, t.durationMs);

/* ------------------------------------------------------------------ */
/* The next control's label                                            */
/* ------------------------------------------------------------------ */

export type NextLabel = "Reveal" | "Answer" | null;

/**
 * What the next control says. A slide with reveal steps left uncovers rather than advances, and
 * the teacher should be able to see which before pressing: "Reveal" for a build, "Answer" for the
 * last step of a question slide, and nothing at all once the slide is fully out, where the plain
 * chevron reads as "on to the next slide".
 */
export function nextLabel(step: number, stepCount: number, isQuestion: boolean): NextLabel {
  if (step >= stepCount) return null;
  return isQuestion && step === stepCount - 1 ? "Answer" : "Reveal";
}
