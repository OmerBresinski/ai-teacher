import type { Id } from "@tj/domain/documents";
import {
  clearTimer,
  freshTimer,
  pauseTimer,
  resetTimer,
  resumeTimer,
  setTimerDuration,
  setTimerMode,
  startTimer,
  type TimerMode,
  type TimerState,
} from "./timer";

/*
 * Present-mode session state as a pure reducer (ADR 0022 §4): TeachDeck's `present-store.ts`
 * (zustand) actions :148-378 with the same names and semantics, minus ink — strokes live in a
 * ref beside the reducer (`use-present-session.ts`) because pointer moves must not dispatch.
 * Deliberately not persisted: none of this outlives the lesson being taught, and annotations are
 * discarded on exit.
 */

export type PresentTool = "none" | "pen" | "highlighter" | "eraser";
export type Blackout = "none" | "black" | "white";

export type PresentState = {
  /** Slide index, and reveal step within it. */
  index: number;
  step: number;
  /** 1 forward, -1 back — the push transition needs to know which way we came. */
  direction: 1 | -1;
  /** Step count per slide, from `slideStepCount`. */
  steps: number[];
  slideIds: Id[];
  ended: boolean;
  /** The furthest slide index shown this session (TD item 5: `reachedSlideId`). */
  reachedIndex: number;

  blackout: Blackout;
  laser: boolean;
  tool: PresentTool;

  timer: TimerState;
  timerOpen: boolean;
  overviewOpen: boolean;
  notesOpen: boolean;
  shortcutsOpen: boolean;
  /** When the presenter started; the notes panel counts up from here. */
  sessionStartedAt: number;

  /** The pill collapsed to just the slide counter. Manual only — idle auto-hide is a separate
      fade and never touches this. */
  pillCollapsed: boolean;
};

export type PresentAction =
  | { type: "setDeck"; slideIds: Id[]; steps: number[]; startIndex?: number }
  | { type: "startSession"; at: number }
  | { type: "next" }
  | { type: "prev" }
  | { type: "goTo"; index: number; step?: number }
  | { type: "first" }
  | { type: "last" }
  | { type: "restart" }
  | { type: "setBlackout"; blackout: Blackout }
  | { type: "toggleBlackout"; blackout: Exclude<Blackout, "none"> }
  | { type: "setTool"; tool: PresentTool }
  | { type: "toggleTool"; tool: Exclude<PresentTool, "none"> }
  | { type: "setLaser"; on: boolean }
  | { type: "toggleLaser" }
  | { type: "setTimerMode"; mode: TimerMode; at: number }
  | { type: "setTimerDuration"; ms: number; at: number }
  | { type: "startTimer"; at: number; ms?: number }
  | { type: "pauseTimer"; at: number }
  | { type: "resumeTimer"; at: number }
  | { type: "resetTimer" }
  | { type: "clearTimer" }
  | { type: "setTimerOpen"; open: boolean }
  | { type: "setOverviewOpen"; open: boolean }
  | { type: "setNotesOpen"; open: boolean }
  | { type: "setShortcutsOpen"; open: boolean }
  | { type: "setPillCollapsed"; collapsed: boolean }
  /** Esc order: overview, then a panel, then a tool. `closedSomething` tells the caller. */
  | { type: "closePanels" }
  | { type: "reset"; at: number };

export const initialPresentState = (at = Date.now()): PresentState => ({
  index: 0,
  step: 0,
  direction: 1,
  steps: [],
  slideIds: [],
  ended: false,
  reachedIndex: 0,
  blackout: "none",
  laser: false,
  tool: "none",
  timer: freshTimer(),
  timerOpen: false,
  overviewOpen: false,
  notesOpen: false,
  shortcutsOpen: false,
  sessionStartedAt: at,
  pillCollapsed: false,
});

const reach = (s: PresentState, index: number): number => Math.max(s.reachedIndex, index);

/**
 * What `closePanels` would close, in Esc order (overview, shortcuts, timer, notes, then a live
 * tool). Blackout is not in the list: any key at all resumes from it, so the key handler has
 * already cleared it before Escape reaches here. Exposed so the key handler can ask "will Esc
 * close something, or exit?" without a second reducer round-trip.
 */
export function panelToClose(
  s: PresentState,
): "overview" | "shortcuts" | "timer" | "notes" | "tool" | null {
  if (s.overviewOpen) return "overview";
  if (s.shortcutsOpen) return "shortcuts";
  if (s.timerOpen) return "timer";
  if (s.notesOpen) return "notes";
  if (s.tool !== "none" || s.laser) return "tool";
  return null;
}

export function presentReducer(s: PresentState, action: PresentAction): PresentState {
  switch (action.type) {
    /* ---------------- navigation ---------------- */
    case "setDeck": {
      const { slideIds, steps, startIndex } = action;
      const same =
        s.slideIds.length === slideIds.length && s.slideIds.every((id, i) => id === slideIds[i]);
      if (same) {
        // An edit elsewhere can take reveal steps off the current slide while it is on screen;
        // the step has to come back inside the new count or a question slide would stay answered.
        const max = steps[s.index] ?? 0;
        return s.step > max ? { ...s, steps, step: max } : { ...s, steps };
      }
      const index = Math.min(Math.max(startIndex ?? 0, 0), Math.max(slideIds.length - 1, 0));
      return {
        ...s,
        slideIds,
        steps,
        index,
        step: 0,
        ended: false,
        direction: 1,
        reachedIndex: index,
      };
    }
    case "startSession":
      return { ...s, sessionStartedAt: action.at };
    /** Step, then slide. The last step of a question slide is the answer. */
    case "next": {
      if (s.ended || s.steps.length === 0) return s;
      if (s.step < (s.steps[s.index] ?? 0)) {
        return { ...s, step: s.step + 1, direction: 1, blackout: "none" };
      }
      if (s.index < s.steps.length - 1) {
        const index = s.index + 1;
        return {
          ...s,
          index,
          step: 0,
          direction: 1,
          blackout: "none",
          reachedIndex: reach(s, index),
        };
      }
      return { ...s, ended: true, blackout: "none" };
    }
    case "prev": {
      if (s.ended) return { ...s, ended: false, blackout: "none" };
      if (s.step > 0) return { ...s, step: s.step - 1, direction: -1, blackout: "none" };
      if (s.index > 0) {
        return {
          ...s,
          index: s.index - 1,
          step: s.steps[s.index - 1] ?? 0,
          direction: -1,
          blackout: "none",
        };
      }
      return s;
    }
    case "goTo": {
      if (s.steps.length === 0) return s;
      const to = Math.min(Math.max(action.index, 0), s.steps.length - 1);
      return {
        ...s,
        index: to,
        step: Math.min(Math.max(action.step ?? 0, 0), s.steps[to] ?? 0),
        direction: to >= s.index ? 1 : -1,
        ended: false,
        blackout: "none",
        reachedIndex: reach(s, to),
      };
    }
    case "first":
      return presentReducer(s, { type: "goTo", index: 0 });
    case "last":
      return presentReducer(s, { type: "goTo", index: s.steps.length - 1 });
    case "restart":
      return { ...s, index: 0, step: 0, ended: false, direction: 1, blackout: "none" };

    /* ---------------- screen and tools ---------------- */
    case "setBlackout":
      return { ...s, blackout: action.blackout };
    case "toggleBlackout":
      return { ...s, blackout: s.blackout === action.blackout ? "none" : action.blackout };
    case "setTool":
      return { ...s, tool: action.tool, laser: action.tool === "none" ? s.laser : false };
    case "toggleTool":
      return {
        ...s,
        tool: s.tool === action.tool ? "none" : action.tool,
        laser: s.tool === action.tool ? s.laser : false,
      };
    case "setLaser":
      return { ...s, laser: action.on, tool: action.on ? "none" : s.tool };
    case "toggleLaser":
      return { ...s, laser: !s.laser, tool: s.laser ? s.tool : "none" };

    /* ---------------- timer ---------------- */
    case "setTimerMode":
      return { ...s, timer: setTimerMode(s.timer, action.mode, action.at) };
    case "setTimerDuration":
      return { ...s, timer: setTimerDuration(s.timer, action.ms, action.at) };
    case "startTimer":
      return { ...s, timer: startTimer(s.timer, action.at, action.ms) };
    case "pauseTimer":
      return { ...s, timer: pauseTimer(s.timer, action.at) };
    case "resumeTimer":
      return { ...s, timer: resumeTimer(s.timer, action.at) };
    case "resetTimer":
      return { ...s, timer: resetTimer(s.timer) };
    case "clearTimer":
      return { ...s, timer: clearTimer(s.timer) };

    /* ---------------- panels ---------------- */
    case "setTimerOpen":
      return { ...s, timerOpen: action.open };
    case "setOverviewOpen":
      return { ...s, overviewOpen: action.open };
    case "setNotesOpen":
      return { ...s, notesOpen: action.open };
    case "setShortcutsOpen":
      return { ...s, shortcutsOpen: action.open };
    case "setPillCollapsed":
      return { ...s, pillCollapsed: action.collapsed };
    case "closePanels": {
      switch (panelToClose(s)) {
        case "overview":
          return { ...s, overviewOpen: false };
        case "shortcuts":
          return { ...s, shortcutsOpen: false };
        case "timer":
          return { ...s, timerOpen: false };
        case "notes":
          return { ...s, notesOpen: false };
        case "tool":
          return { ...s, tool: "none", laser: false };
        default:
          return s;
      }
    }
    case "reset":
      return initialPresentState(action.at);
    default:
      return s;
  }
}
