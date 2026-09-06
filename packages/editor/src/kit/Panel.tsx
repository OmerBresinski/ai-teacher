import { cn } from "@tj/ui";
import type { HTMLAttributes, ReactNode, Ref } from "react";

/*
 * The floating card every editor toolbar, drawer and inspector sits in, and the present-mode
 * pills (TeachDeck `components/ui2/Panel.tsx`). No `@tj/ui` twin: a Panel is positioned geometry
 * — the caller places it — with no header, footer or focus semantics, so `Card`/`Popover` would
 * be the wrong primitive. It paints from the shadcn variables, so inside `.tj-stage` it is the
 * stage surface with no `tone` prop: the scope does the dark variant (ADR 0022 §3).
 */

export type PanelProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** 'bar' is a horizontal strip of controls; 'card' is a padded block. Default 'bar'. */
  as?: "bar" | "card";
  /**
   * Adds the shared arrival motion. Default FALSE: most panels are repositioned, not arrived, and
   * a fade on every mount reads as a flicker following the pointer. A drawer opening opts in.
   */
  animate?: boolean;
  /** Inner padding on `as="card"`: 12px (`card`), 6px (`menu`, for full-bleed rows) or none. */
  pad?: "card" | "menu" | "none";
  /** `as="bar"` height: 40px (`md`), 32px (`sm`) or 24px (`xs`). */
  size?: "xs" | "sm" | "md";
  ref?: Ref<HTMLDivElement>;
};

export function Panel({
  children,
  as = "bar",
  animate = false,
  pad = "card",
  size = "md",
  className,
  ref,
  ...rest
}: PanelProps) {
  return (
    <div
      ref={ref}
      {...rest}
      className={cn(
        as === "bar"
          ? cn(
              "flex items-center gap-1 rounded-control px-2",
              size === "md" ? "h-10" : size === "sm" ? "h-8" : "h-6",
            )
          : cn("rounded-control", pad === "card" && "p-3", pad === "menu" && "p-1.5"),
        "bg-card text-card-foreground shadow-2",
        animate && "motion-safe:animate-arrive",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PanelSeparator() {
  return <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-border" />;
}

export type PanelLabelProps = HTMLAttributes<HTMLSpanElement> & { children: ReactNode };

/** Rest props are spread so a caller can pass `id` (to bind a control to it) or `aria-hidden`. */
export function PanelLabel({ children, className, ...rest }: PanelLabelProps) {
  return (
    <span {...rest} className={cn("shrink-0 pr-1 pl-2 text-body text-ink-3", className)}>
      {children}
    </span>
  );
}

export type PanelRowProps = {
  children: ReactNode;
  /** A label bound to the control in `children`; a real `<label>` when `htmlFor` is given. */
  label?: ReactNode;
  htmlFor?: string;
  className?: string;
};

export function PanelRow({ children, label, htmlFor, className }: PanelRowProps) {
  return (
    <div
      className={cn(
        "flex min-h-8 items-center justify-between gap-3 text-meta text-ink-2",
        className,
      )}
    >
      {label != null ? (
        htmlFor ? (
          <label htmlFor={htmlFor} className="shrink-0 font-medium text-ink-3 text-meta">
            {label}
          </label>
        ) : (
          <span className="shrink-0 font-medium text-ink-3 text-meta">{label}</span>
        )
      ) : null}
      {children}
    </div>
  );
}
