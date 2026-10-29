/**
 * The ship gate for layout faults (TEACH-247 part af). No slide ships with an overlap,
 * clipped text or a block off the slide that code could have fixed: the writer's checks only log in
 * production (`checks: "log"`), so this runs after every other step, with no model call. A slide
 * still at fault falls back to a safer layout for the same words, in order:
 *
 * 0. the other layout that holds the same visual (big visual and visual beside words, TEACH-251
 *    part s: romans verify3 s3 lost its map to a clipped line the other layout had room for);
 * 1. its list split over continuation slides (the visual stays on the slide).
 *
 * Dropping the visual is never a fallback (TEACH-247 part cb, Greg: "a visual should never be
 * lost"; Plants s3 shipped its hook as a bare prompt): a slide nothing clears keeps its visual
 * and is reported `left`, with its faults, for the fix to land where the fault is (the layout or
 * the check), not in the lesson.
 *
 * A fallback that leaves faults is undone. Each slide's outcome is returned for the log.
 */
/**
 * What the gate acts on: words or a card under other words or a picture, or past the slide's
 * edge. An `overflow:` row (a field over its measured room but still on the slide) is not one:
 * it stays as laid (Greg 71 A, 20 Oct), and what it pushes off the slide is `clipped`.
 */
export const LAYOUT_FAULT = /^(clipped|overlap|off-slide):/;

/** Continuation slides a gate split may add to one slide (rulings 261, 295: one or two). */
export const MAX_GATE_PARTS = 2;

export type GateOutcome = "clean" | "switched" | "split" | "left";

/** The layouts a slide's visual can move to with the same words (TEACH-251 part s). */
export const GATE_SWITCH: Record<string, readonly string[]> = {
  "big-visual": ["visual-text"],
  "visual-text": ["big-visual"],
};

export type GateSteps = {
  /** The slide's layout faults as it stands now. */
  faults: () => string[];
  /**
   * Lays the slide in another layout that still shows every visual it had; false when there is
   * none (or none keeps the visuals). Optional: a caller without one goes straight to the split.
   */
  switchLayout?: () => boolean;
  /** Puts the slide back in its own layout after a switch that did not clear the faults. */
  undoSwitch?: () => void;
  /** Splits the slide over continuation slides; false when no split fits or it adds too many. */
  split: () => boolean;
  /** Puts the slide back whole after a split that left faults in any part. */
  undoSplit: () => void;
};

export function layoutGate(steps: GateSteps): { outcome: GateOutcome; faults: string[] } {
  const before = steps.faults();
  if (!before.length) return { outcome: "clean", faults: [] };
  if (steps.switchLayout?.()) {
    if (!steps.faults().length) return { outcome: "switched", faults: before };
    steps.undoSwitch?.();
  }
  if (steps.split()) {
    if (!steps.faults().length) return { outcome: "split", faults: before };
    steps.undoSplit();
  }
  return { outcome: "left", faults: steps.faults() };
}
