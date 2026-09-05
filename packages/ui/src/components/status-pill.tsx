import type * as React from "react";

import { cn } from "../lib/cn";

export type StatusPillTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type StatusPillProps = React.ComponentProps<"span"> & {
  tone?: StatusPillTone;
  dot?: boolean;
  opaque?: boolean;
};

const tones: Record<StatusPillTone, string> = {
  neutral: "bg-accent-active border-border text-ink-2",
  accent: "bg-brand-tint border-brand-tint-line text-brand-text",
  success: "bg-success/10 border-success/20 text-success",
  warning: "bg-warning/10 border-warning/20 text-warning",
  danger: "bg-destructive/10 border-destructive/20 text-destructive",
};

const opaqueTones: Record<StatusPillTone, string> = {
  neutral: "bg-card border-border text-ink-2",
  accent: "bg-card border-brand-tint-line text-brand-text",
  success: "bg-card border-success/20 text-success",
  warning: "bg-card border-warning/20 text-warning",
  danger: "bg-card border-destructive/20 text-destructive",
};

function StatusPill({
  tone = "neutral",
  dot = false,
  opaque = false,
  className,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-eyebrow font-semibold whitespace-nowrap",
        opaque ? opaqueTones[tone] : tones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden className="size-[5px] rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export { StatusPill };
