import { Check } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/cn";

/*
 * A step rail for one-question-at-a-time flows (plan review). A `nav` of steps in order: the
 * current one carries `aria-current="step"`, completed ones a tick, and an "N of M" line keeps
 * the position readable without the colour. Completed steps are buttons when `onSelect` is
 * given, so a teacher can go back to one; the others are plain text (the flow moves forward
 * through its own Continue). Done and current share the one brand accent (current filled, done
 * tinted) so the rail reads as one line of progress, not two colours. Vertical by default;
 * `orientation="horizontal"` lays the steps in a row for narrow shells.
 */

export type StepRailStep = { id: string; label: string };

export type StepRailProps = Omit<React.ComponentProps<"nav">, "onSelect"> & {
  steps: readonly StepRailStep[];
  /** The step the teacher is on. */
  current: string;
  /** Steps already confirmed. */
  done?: readonly string[];
  orientation?: "vertical" | "horizontal";
  /** Called with a completed step's id; without it the rail is read-only. */
  onSelect?: (id: string) => void;
};

function StepRail({
  steps,
  current,
  done = [],
  orientation = "vertical",
  onSelect,
  className,
  "aria-label": ariaLabel = "Steps",
  ...props
}: StepRailProps) {
  const index = Math.max(
    0,
    steps.findIndex((step) => step.id === current),
  );
  const vertical = orientation === "vertical";
  return (
    <nav
      data-slot="step-rail"
      data-orientation={orientation}
      aria-label={ariaLabel}
      className={cn("text-body", className)}
      {...props}
    >
      <p className="mb-2 text-meta text-ink-3 tabular-nums">
        {index + 1} of {steps.length}
      </p>
      <ol className={cn("flex gap-1", vertical ? "flex-col" : "flex-row flex-wrap gap-x-3")}>
        {steps.map((step, i) => {
          const isCurrent = step.id === current;
          const isDone = done.includes(step.id);
          const content = (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-eyebrow font-semibold tabular-nums",
                  isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : isDone
                      ? "border-brand-tint-line bg-brand-tint text-brand-text"
                      : "border-border text-ink-3",
                )}
              >
                {isDone && !isCurrent ? <Check size={12} strokeWidth={2.5} /> : i + 1}
              </span>
              <span className={cn("truncate", isCurrent ? "font-semibold" : "font-medium")}>
                {step.label}
              </span>
              {isDone && !isCurrent ? <span className="sr-only">, done</span> : null}
            </>
          );
          const rowClass = cn(
            "flex h-8 w-full items-center gap-2.5 rounded-control px-2 text-left",
            isCurrent ? "bg-brand-quiet text-brand-text" : isDone ? "text-ink-2" : "text-ink-3",
          );
          return (
            <li key={step.id} aria-current={isCurrent ? "step" : undefined}>
              {isDone && !isCurrent && onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(step.id)}
                  className={cn(
                    rowClass,
                    "outline-none hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:transition-colors",
                  )}
                >
                  {content}
                </button>
              ) : (
                <div className={rowClass}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export { StepRail };
