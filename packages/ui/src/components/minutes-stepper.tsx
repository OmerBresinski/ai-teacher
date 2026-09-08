import { Minus, Plus } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { cn } from "../lib/cn";

/*
 * Whole minutes in a 32px group: minus, a typed field, plus. The field keeps a draft while it has
 * focus and commits only a value it can clamp into `[min, max]` (the editor's `NumberInput`
 * pattern, without the scrub). Arrow keys step, Shift steps by five. The field is a spinbutton
 * with the value read as "N minutes".
 */

export type MinutesStepperProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** The accessible name of the field, e.g. "Minutes for Starter". */
  label: string;
  disabled?: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function MinutesStepper({
  value,
  onChange,
  min = 1,
  max = 180,
  step = 1,
  label,
  disabled = false,
  className,
  ...props
}: MinutesStepperProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) onChange(clamp(parsed, min, max));
    setDraft(null);
  };
  const stepBy = (delta: number) => onChange(clamp(value + delta, min, max));
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const sign = event.key === "ArrowUp" ? 1 : -1;
      stepBy(sign * (event.shiftKey ? step * 5 : step));
    } else if (event.key === "Enter" && draft !== null) {
      // Commit the draft; the shell above may also treat Enter as "continue".
      commit(draft);
    } else if (event.key === "Escape" && draft !== null) {
      event.stopPropagation();
      setDraft(null);
    }
  };
  const buttonClass =
    "flex size-8 items-center justify-center text-ink-2 outline-none hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-safe:transition-colors";
  return (
    <div
      data-slot="minutes-stepper"
      className={cn(
        "inline-flex h-8 items-stretch overflow-hidden rounded-control border border-input bg-secondary shadow-xs",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        aria-label={`Fewer minutes: ${label}`}
        className={buttonClass}
        onClick={() => stepBy(-step)}
        disabled={disabled || value <= min}
        tabIndex={-1}
      >
        <Minus aria-hidden size={14} strokeWidth={1.5} />
      </button>
      <input
        role="spinbutton"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={`${value} minutes`}
        inputMode="numeric"
        disabled={disabled}
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={onKeyDown}
        className="w-10 border-x border-input bg-transparent text-center text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      />
      <button
        type="button"
        aria-label={`More minutes: ${label}`}
        className={buttonClass}
        onClick={() => stepBy(step)}
        disabled={disabled || value >= max}
        tabIndex={-1}
      >
        <Plus aria-hidden size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export { MinutesStepper };
