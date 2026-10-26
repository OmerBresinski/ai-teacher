/**
 * The ship gate for layout faults (TEACH-247 part af). No slide ships with an overlap,
 * clipped text or a block off the slide that code could have fixed: the writer's checks only log in
 * production (`checks: "log"`), so this runs after every other step, with no model call. A slide
 * still at fault falls back to a safer layout for the same words, in order:
 *
 * 1. its list split over continuation slides (the visual stays: a planned visual is never lost
 *    while another layout holds it);
 * 2. its visuals dropped (the slide is laid again with its `ask_without` lines, the words alone).
 *
 * A fallback that leaves faults is undone. Each slide's outcome is returned for the log.
 */
/**
 * What the gate acts on: words or a card under other words or a picture, or past the slide's
 * edge. An `overflow:` row (a field over its measured room but still on the slide) is not one:
 * it stays as laid (Greg 71 A, 20 Oct), and what it pushes off the slide is `clipped`.
 */
export const LAYOUT_FAULT = /^(clipped|overlap|off-slide):/;

export type GateOutcome = "clean" | "dropped-visual" | "split" | "left";

export type GateSteps = {
  /** The slide's layout faults as it stands now. */
  faults: () => string[];
  /** Lays the slide out again without its visuals; false when it has none to drop. */
  dropVisuals: () => boolean;
  /** Puts the visuals back after a drop that did not clear the faults. */
  undoDrop: () => void;
  /** Splits the slide over continuation slides; false when no split fits. */
  split: () => boolean;
};

export function layoutGate(steps: GateSteps): { outcome: GateOutcome; faults: string[] } {
  const before = steps.faults();
  if (!before.length) return { outcome: "clean", faults: [] };
  if (steps.split() && !steps.faults().length) return { outcome: "split", faults: before };
  if (steps.dropVisuals()) {
    if (!steps.faults().length) return { outcome: "dropped-visual", faults: before };
    steps.undoDrop();
  }
  return { outcome: "left", faults: steps.faults() };
}
