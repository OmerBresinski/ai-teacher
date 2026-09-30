import { flushSync } from "react-dom";

/** Plan's reading beats on the planning stage (the rig's work beats 14-18). It reads; it never writes. */
export const READING = { pickUp: 14, line: 15, page: 16, lookUp: 17, lower: 18 } as const;

/**
 * The beat after `beat` while Plan reads the brief: three lines, then the next page or (every third
 * page) a look up with a nod, in turn. Lowering the brief (`READING.lower`) is never chosen here: it
 * plays once, when the objectives are saved.
 */
export function readingOrder() {
  let lines = 0,
    pages = 0;
  return (beat: number): number => {
    if (beat !== READING.line) return READING.line;
    lines++;
    if (lines % 3) return READING.line;
    pages++;
    return pages % 3 === 2 ? READING.lookUp : READING.page;
  };
}

/**
 * Leave the planning stage for the column layout: Plan shrinks from centre stage to its side slot
 * (a view transition), then the objectives step shows. Without view transitions or with reduced
 * motion the step simply changes.
 */
export function leaveStage(update: () => void) {
  const still =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof document.startViewTransition !== "function" || still) return update();
  // Name the character in both layouts only for this transition, so the two snapshots pair up.
  const root = document.documentElement;
  root.dataset.planExit = "";
  const transition = document.startViewTransition(() => flushSync(update));
  void transition.finished.finally(() => delete root.dataset.planExit);
}
