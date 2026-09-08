import { Button } from "@tj/ui";
import { Plus } from "lucide-react";
import { type ReactNode, type RefObject, useEffect } from "react";
import type { PlanReviewState } from "@/lib/plan-review";
import { isYours } from "@/lib/plan-review";

/** Focus the step's first control on arrival (each step remounts on a step change). */
export function useArrivalFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    ref.current?.focus();
  }, [ref]);
}

export const markOf = (state: PlanReviewState, key: string): "suggested" | "yours" =>
  isYours(state, key) ? "yours" : "suggested";

/** The kit's arrive animation with the per-row stagger, capped at six rows. */
export const arrive = (index: number) => ({
  className: "motion-safe:animate-arrive",
  style: { animationDelay: `calc(var(--stagger) * ${Math.min(index, 5)})` },
});

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
