import { cn } from "@tj/ui";
import { useRef, useState } from "react";
import { clamp, format, round } from "./math";

/*
 * The free-typing-then-clamp number field with a drag-to-scrub handle (TeachDeck
 * `components/ui2/NumberInput.tsx`). No `@tj/ui` twin: `Input` has no draft/commit cycle, no
 * spinbutton semantics and no scrub — the inspector geometry rows and the timer's minutes need all
 * three. Keeps a draft while it has focus and only commits a value it can clamp into `[min, max]`.
 */

export type NumberInputProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Default 1. */
  step?: number;
  /** Multiplier while Shift is held — on the arrow keys and on a scrub alike. Default 10. */
  coarse?: number;
  /** e.g. 'pt', '%', '°'. Doubles as a drag-to-scrub handle when there is no `label`. */
  unit?: string;
  /** The drag-to-scrub handle. Without it (and without `unit`) the field is keyboard-only. */
  label?: React.ReactNode;
  /** Decimal places, default 0. */
  precision?: number;
  disabled?: boolean;
  /** On the inner input, so a `<label htmlFor>` can point at it. */
  id?: string;
  /** Field width in characters, default 4. */
  width?: number;
  className?: string;
  "aria-label"?: string;
};

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  coarse = 10,
  unit,
  label,
  precision = 0,
  disabled = false,
  id,
  width = 4,
  className,
  "aria-label": ariaLabel,
}: NumberInputProps) {
  const [editing, setEditing] = useState(false);
  // Only meaningful while `editing`; otherwise the input renders `format(value)` from props.
  const [draft, setDraft] = useState(() => format(value, precision));
  const inputRef = useRef<HTMLInputElement>(null);
  const skipCommitRef = useRef(false);
  const dragRef = useRef<{ startX: number; dragged: boolean } | null>(null);

  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      const next = clamp(round(parsed, precision), min, max);
      onChange(next);
      setDraft(format(next, precision));
    } else {
      setDraft(format(value, precision));
    }
  };

  const stepBy = (delta: number) => {
    const next = clamp(round(value + delta, precision), min, max);
    onChange(next);
    setDraft(format(next, precision));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const sign = e.key === "ArrowUp" ? 1 : -1;
      stepBy(sign * (e.shiftKey ? step * coarse : step));
    } else if (e.key === "Enter") {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(format(value, precision));
      skipCommitRef.current = true;
      inputRef.current?.blur();
    }
  };

  const onHandlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, dragged: false };
  };

  const onHandlePointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    if (!drag || e.movementX === 0) return;
    // Nothing moves until the 2px threshold is crossed, so a click that jitters cannot edit.
    if (!drag.dragged && Math.abs(e.clientX - drag.startX) <= 2) return;
    drag.dragged = true;
    const delta = (e.movementX / 2) * (e.shiftKey ? step * coarse : step);
    const next = clamp(round(value + delta, precision), min, max);
    if (next !== value) onChange(next);
  };

  const onHandlePointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onHandleClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    if (dragRef.current?.dragged) e.preventDefault();
    else inputRef.current?.focus();
    dragRef.current = null;
  };

  const scrubHandlers = {
    onPointerDown: onHandlePointerDown,
    onPointerMove: onHandlePointerMove,
    onPointerUp: onHandlePointerUp,
    onClick: onHandleClick,
  };

  return (
    <div
      className={cn(
        "relative inline-flex h-8 w-fit items-center rounded-control border border-input bg-secondary",
        "motion-safe:transition-colors",
        !disabled && "focus-within:border-ring hover:border-border-control",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {label ? (
        <span
          {...scrubHandlers}
          className="flex h-full shrink-0 select-none items-center pr-1.5 pl-2.5 text-ink-3 text-meta"
          style={{ cursor: disabled ? undefined : "ew-resize" }}
        >
          {label}
        </span>
      ) : null}
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        // A bare text box gives a screen reader no range; a spinbutton does.
        role="spinbutton"
        aria-label={ariaLabel}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={unit ? `${format(value, precision)}${unit}` : undefined}
        value={editing ? draft : format(value, precision)}
        onFocus={() => {
          setEditing(true);
          setDraft(format(value, precision));
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (skipCommitRef.current) {
            skipCommitRef.current = false;
            return;
          }
          commit(draft);
        }}
        onKeyDown={onKeyDown}
        // `ch` is the width of a "0", which is what a tabular number field is measured in.
        style={{ width: `${width}ch` }}
        className={cn(
          "h-full min-w-0 flex-1 rounded-control bg-transparent text-body text-foreground tabular-nums outline-none",
          !label && "pl-2.5",
          unit ? "pr-1.5" : "pr-2.5",
        )}
      />
      {unit ? (
        <span
          {...(label ? {} : scrubHandlers)}
          className="shrink-0 select-none pr-2.5 text-ink-3 text-meta"
          style={label || disabled ? undefined : { cursor: "ew-resize" }}
        >
          {unit}
        </span>
      ) : null}
    </div>
  );
}
