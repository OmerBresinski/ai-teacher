import {
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  IconButton,
} from "@tj/ui";
import { ChevronDown, Minus, Plus } from "lucide-react";

/*
 * The bottom-right zoom readout (TeachDeck `components/ui2/ZoomControl.tsx`). No `@tj/ui` twin: it
 * is a hairline group of three controls that behave as one object — minus, the percentage trigger
 * and plus at 32px on the `--border` edge with a 1px divider between members. The menu inside it is
 * the `@tj/ui` DropdownMenu (ADR 0022 §2).
 */

export type ZoomValue = number | "fit";

export type ZoomControlProps = {
  /**
   * 1 is 100 percent. `'fit'` is the editor's own state: the canvas is sized to the window, and the
   * percentage shown comes from `scale` — the measured result — rather than from this value.
   */
  value: ZoomValue;
  onChange: (value: number) => void;
  /** The scale actually being rendered. Only needed when `value` can be `'fit'`. */
  scale?: number;
  /** The stops the menu offers and the minus and plus buttons walk. */
  steps?: number[];
  /** A "Fit to window" entry in the menu, when the caller can compute it. */
  onFit?: () => void;
  className?: string;
};

const DEFAULT_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8];

/**
 * The next step in `steps` in the given direction, clamping at the ends. Returns `value` unchanged
 * when there are no steps, so an empty array cannot push `undefined` into zoom state.
 */
export function nextStep(steps: number[], value: number, dir: 1 | -1): number {
  const sorted = [...steps].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return value;
  if (dir === 1) return sorted.find((s) => s > value + 1e-6) ?? last;
  return [...sorted].reverse().find((s) => s < value - 1e-6) ?? first;
}

export function ZoomControl({
  value,
  onChange,
  scale,
  steps = DEFAULT_STEPS,
  onFit,
  className,
}: ZoomControlProps) {
  const fit = value === "fit";
  const current = fit ? (scale ?? 1) : value;
  const percent = Math.round(current * 100);

  return (
    <div
      data-zoom-control
      className={cn(
        "inline-flex h-8 items-stretch overflow-hidden rounded-chip bg-card",
        "shadow-[inset_0_0_0_1px_var(--border)]",
        "[&>*+*]:border-border [&>*+*]:border-l",
        className,
      )}
    >
      <IconButton
        label="Zoom out"
        className="rounded-none"
        onClick={() => onChange(nextStep(steps, current, -1))}
      >
        <Minus aria-hidden size={16} strokeWidth={1.5} />
      </IconButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* The name carries the percentage: "Zoom" alone says the control exists, not what it is. */}
          <button
            type="button"
            aria-label={`Zoom, ${percent} percent`}
            data-tabular
            className="inline-flex h-8 min-w-16 items-center justify-center gap-0.5 rounded-none px-1.5 text-foreground text-meta tabular-nums outline-none transition-colors duration-(--duration-fast) ease-(--ease-out-soft) hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent-active"
          >
            {percent}%
            <ChevronDown aria-hidden size={14} strokeWidth={1.5} className="text-ink-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end">
          {onFit ? (
            <>
              <DropdownMenuCheckboxItem checked={fit} onSelect={onFit}>
                Fit to window
                <DropdownMenuShortcut>⌘⌥0</DropdownMenuShortcut>
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {steps.map((s) => (
            <DropdownMenuCheckboxItem
              key={s}
              checked={!fit && Math.abs(s - current) < 1e-6}
              onSelect={() => onChange(s)}
            >
              {Math.round(s * 100)}%
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <IconButton
        label="Zoom in"
        className="rounded-none"
        onClick={() => onChange(nextStep(steps, current, 1))}
      >
        <Plus aria-hidden size={16} strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}
