import { cn } from "@tj/ui";
import { type ReactNode, useRef } from "react";
import { useIndicator } from "./use-indicator";

/*
 * A sunken track with one raised chip (TeachDeck `components/ui2/Segmented.tsx`). No `@tj/ui`
 * twin: `Tabs` is a terracotta underline that switches a region, and `RadioGroup` is a stacked
 * form control; this is the compact value picker the timer panel and the inspectors use. The chip
 * is the whole active idiom — no underline on it.
 */

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** Announced instead of `label` when the label is an icon. */
  srLabel?: string;
  disabled?: boolean;
};

export type SegmentedProps<T extends string> = {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  /** Stretch each option to an equal share of the width. */
  stretch?: boolean;
  /** `tabs` swaps the radiogroup semantics for tablist/tab; the look does not change. */
  as?: "radiogroup" | "tabs";
  /** `tabs` only: the id of the region the selected tab controls. */
  controls?: string;
  "aria-label"?: string;
  className?: string;
};

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "sm",
  stretch = false,
  as = "radiogroup",
  controls,
  className,
  "aria-label": ariaLabel,
}: SegmentedProps<T>) {
  const tabs = as === "tabs";
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const rect = useIndicator(
    trackRef,
    itemRefs,
    value as string,
    options.map((o) => o.value).join("\u0000"),
  );

  // On the option buttons, not on the track: a native <button> is the right place for a key
  // handler, and the track's role is chosen at runtime.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!dir) return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + dir + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    itemRefs.current.get(next.value)?.focus();
  };

  // Roving tabindex needs exactly one tabbable option, even if `value` matches nothing enabled.
  const selectedIsTabbable = options.some((o) => o.value === value && !o.disabled);
  const fallbackTabValue = selectedIsTabbable
    ? null
    : (options.find((o) => !o.disabled)?.value ?? null);

  return (
    <div
      ref={trackRef}
      // Spread, not inline: Biome's a11y rule checks aria props against a static role, and the
      // role here is chosen at runtime.
      {...(tabs
        ? { role: "tablist", "aria-label": ariaLabel, "aria-orientation": "horizontal" as const }
        : { role: "radiogroup", "aria-label": ariaLabel })}
      className={cn(
        // The height lives on the track: with `p-0.5` here and the height on the option, a "32px"
        // control measured 36.
        "relative inline-flex items-stretch rounded-control bg-secondary p-0.5 ring-1 ring-border",
        size === "md" ? "h-9" : "h-8",
        stretch && "w-full",
        className,
      )}
    >
      {rect ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 bottom-0.5 left-0 rounded-chip bg-card shadow-1 motion-safe:transition-[transform,width]"
          style={{ width: rect.w, transform: `translateX(${rect.x}px)` }}
        />
      ) : null}

      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              if (el) itemRefs.current.set(o.value, el);
              else itemRefs.current.delete(o.value);
            }}
            type="button"
            {...(tabs
              ? { role: "tab", "aria-selected": selected, "aria-controls": controls }
              : { role: "radio", "aria-checked": selected })}
            aria-label={o.srLabel}
            disabled={o.disabled}
            tabIndex={selected || o.value === fallbackTabValue ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
            className={cn(
              "relative z-1 inline-flex min-w-16 items-center justify-center gap-1.5 whitespace-nowrap rounded-chip px-3 text-body",
              "outline-none motion-safe:transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "disabled:pointer-events-none disabled:text-ink-4",
              stretch && "flex-1",
              selected ? "font-semibold text-foreground" : "text-ink-3 hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
