import type * as React from "react";
import { useId, useRef, useState } from "react";

import { cn } from "../lib/cn";

/*
 * The shape of a lesson at a glance: its phases as a horizontal strip of compact blocks, each a
 * kind label over its minutes, each block's width proportional to its minutes (with a floor so a
 * two-minute title still reads and a one-word label is never cut). One block can be selected: the caller renders its `detail` (a
 * minutes stepper, Remove) under the strip, and the block carries `aria-expanded`. Arrow keys move
 * focus along the strip, Enter or Space selects, Escape closes the detail and returns focus to the
 * block, Alt+Arrow moves a block, and a pointer drag along the strip moves one too. A block whose
 * minutes change animates its width; reduced motion collapses that.
 */

export type PhaseStripItem = { id: string; label: string; minutes: number };

export type PhaseStripProps = Omit<React.ComponentProps<"div">, "onSelect"> & {
  phases: readonly PhaseStripItem[];
  /** The block whose detail is open, if any. */
  selectedId?: string | null;
  onSelect: (id: string | null) => void;
  /** Called with the block's index and the index it should land on. */
  onMove?: (from: number, to: number) => void;
  /** Rendered under the strip while `selectedId` names a block. */
  detail?: React.ReactNode;
  /** The strip's accessible name. */
  label?: string;
  /** Pixel floor for a block, default 80: room for the longest one-word kind label. */
  minWidth?: number;
};

/** Pointer travel before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

type Press = { index: number; startX: number; active: boolean; pointerId: number };

function PhaseStrip({
  phases,
  selectedId = null,
  onSelect,
  onMove,
  detail,
  label = "Phases",
  minWidth = 80,
  className,
  ...props
}: PhaseStripProps) {
  const id = useId();
  const detailId = `${id}-detail`;
  const listRef = useRef<HTMLOListElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const press = useRef<Press | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const selected = phases.find((phase) => phase.id === selectedId) ?? null;

  const focusIndex = (index: number) => {
    const phase = phases[Math.max(0, Math.min(phases.length - 1, index))];
    if (phase) buttons.current.get(phase.id)?.focus();
  };

  /** The index a pointer at `clientX` would drop a block on. */
  const indexAt = (clientX: number, from: number): number => {
    const items = Array.from(listRef.current?.children ?? []) as HTMLElement[];
    // The first block whose midpoint is right of the pointer takes the drop; past every midpoint
    // is the end. Moving rightwards, the pressed block leaves its slot first, so the target is one
    // less.
    let to = items.length;
    for (const [i, item] of items.entries()) {
      const rect = item.getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        to = i;
        break;
      }
    }
    return to > from ? to - 1 : to;
  };

  const release = () => {
    press.current = null;
    setDrag(null);
  };

  return (
    <div data-slot="phase-strip" className={cn("flex flex-col gap-3", className)} {...props}>
      <ol ref={listRef} aria-label={label} className="flex w-full gap-1">
        {phases.map((phase, i) => {
          const isSelected = phase.id === selectedId;
          const isDragged = drag?.from === i;
          const isTarget = drag !== null && drag.to === i && drag.from !== i;
          return (
            <li
              key={phase.id}
              className={cn(
                "flex min-w-0 motion-safe:transition-[flex-grow] motion-safe:duration-[var(--duration-base)]",
                isTarget &&
                  (drag.to < drag.from
                    ? "shadow-[-3px_0_0_var(--color-primary)]"
                    : "shadow-[3px_0_0_var(--color-primary)]"),
              )}
              style={{ flexGrow: phase.minutes, flexBasis: 0, minWidth }}
            >
              <button
                type="button"
                ref={(element) => {
                  if (element) buttons.current.set(phase.id, element);
                  else buttons.current.delete(phase.id);
                }}
                aria-label={`${phase.label}, ${phase.minutes} minutes, phase ${i + 1} of ${phases.length}`}
                aria-pressed={isSelected}
                aria-expanded={isSelected}
                aria-controls={isSelected && detail ? detailId : undefined}
                data-phase-id={phase.id}
                className={cn(
                  "flex h-16 w-full min-w-0 cursor-grab flex-col items-start justify-center gap-0.5 rounded-control border px-1.5 text-left outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:transition-colors active:cursor-grabbing",
                  isSelected
                    ? "border-primary bg-brand-quiet text-brand-text"
                    : "border-border bg-card text-foreground hover:bg-accent",
                  isDragged && "opacity-40",
                )}
                style={{ touchAction: "none" }}
                onClick={() => {
                  if (press.current?.active) return;
                  onSelect(isSelected ? null : phase.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const delta = event.key === "ArrowRight" ? 1 : -1;
                    if (event.altKey) onMove?.(i, i + delta);
                    else focusIndex(i + delta);
                  } else if (event.key === "Escape" && isSelected) {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelect(null);
                  }
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0 || !onMove) return;
                  press.current = {
                    index: i,
                    startX: event.clientX,
                    active: false,
                    pointerId: event.pointerId,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const current = press.current;
                  if (!current || current.index !== i) return;
                  if (!current.active) {
                    if (Math.abs(event.clientX - current.startX) < DRAG_THRESHOLD_PX) return;
                    current.active = true;
                  }
                  const to = indexAt(event.clientX, i);
                  setDrag((previous) =>
                    previous?.from === i && previous.to === to ? previous : { from: i, to },
                  );
                }}
                onPointerUp={(event) => {
                  const current = press.current;
                  if (!current || current.index !== i) return;
                  const to = current.active ? indexAt(event.clientX, i) : null;
                  const wasDrag = current.active;
                  event.currentTarget.releasePointerCapture(current.pointerId);
                  release();
                  if (to !== null && to !== i) onMove?.(i, to);
                  // Keep the click handler from toggling the detail after a drag.
                  if (wasDrag) press.current = { index: i, startX: 0, active: true, pointerId: -1 };
                  window.setTimeout(() => {
                    if (press.current?.pointerId === -1) press.current = null;
                  }, 0);
                }}
                onPointerCancel={release}
              >
                <span className="line-clamp-2 w-full text-eyebrow font-medium leading-tight">
                  {phase.label}
                </span>
                <span className="text-eyebrow text-ink-3 tabular-nums">{phase.minutes} min</span>
              </button>
            </li>
          );
        })}
      </ol>
      {selected && detail ? (
        // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Escape inside the detail closes it and returns focus to its block
        <fieldset
          id={detailId}
          className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-card p-3 shadow-1 motion-safe:animate-arrive [--tj-arrive-distance:6px]"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            onSelect(null);
            buttons.current.get(selected.id)?.focus();
          }}
        >
          <legend className="sr-only">{selected.label} phase</legend>
          {detail}
        </fieldset>
      ) : null}
    </div>
  );
}

export { PhaseStrip };
