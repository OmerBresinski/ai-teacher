import { flushSync } from "react-dom";

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
