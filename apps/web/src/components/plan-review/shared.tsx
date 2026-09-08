import { Button } from "@tj/ui";
import { Plus } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useState } from "react";
import type { PlanReviewState } from "@/lib/plan-review";
import { isYours } from "@/lib/plan-review";

/** Focus the step's first control on arrival (each step remounts on a step change). */
export function useArrivalFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    // A long line would otherwise scroll to the caret at its end; start at the start.
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.setSelectionRange(0, 0);
      element.scrollTop = 0;
    }
  }, [ref]);
}

export const markOf = (state: PlanReviewState, key: string): "suggested" | "yours" =>
  isYours(state, key) ? "yours" : "suggested";

/** The arrive animation's longest run: the 450ms rise after the sixth row's stagger. */
const ARRIVE_SETTLED_MS = 450 + 5 * 40 + 50;

/**
 * Whether the rows have finished arriving. Moving a row in the DOM (a reorder) restarts its CSS
 * animation, which would hide it for the stagger delay again; once settled the class comes off.
 */
export function useArriveSettled(): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), ARRIVE_SETTLED_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return settled;
}

/** The kit's arrive animation with the per-row stagger, capped at six rows. */
export const arrive = (index: number, settled = false) =>
  settled
    ? { className: undefined, style: undefined }
    : {
        className: "motion-safe:animate-arrive",
        style: { animationDelay: `calc(var(--stagger) * ${Math.min(index, 5)})` },
      };

export function AddRowButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={disabled} className="self-start">
      <Plus aria-hidden size={14} strokeWidth={1.5} />
      {children}
    </Button>
  );
}
