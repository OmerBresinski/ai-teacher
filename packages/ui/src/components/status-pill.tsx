import type * as React from "react";

import { cn } from "../lib/cn";

export type StatusPillTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type StatusPillProps = React.ComponentProps<"span"> & {
  tone?: StatusPillTone;
  /** A 5px dot before the label. Always on for `quiet`. */
  dot?: boolean;
  /**
   * Card fill with the tone's hairline instead of the tint. For a pill over a thumbnail or a
   * photo, where a translucent tint picks up whatever is behind it.
   */
  opaque?: boolean;
  /**
   * No container: a tone-coloured dot and an ink-2 label. For list rows and meta lines, where a
   * tinted capsule would compete with the row's title.
   */
  quiet?: boolean;
};

/*
 * A pill is a label, not a control: 12/500, 24px, fully round, no hover, no ARIA.
 * One boundary per pill: the tinted pill has no border, the opaque pill has no tint. Colour is
 * carried by the label alone (dot optional), never by tint + border + dot + weight together.
 * The accent tone's label uses brand-text (#B04A33), the accent as text under 18px.
 */
const tints: Record<StatusPillTone, string> = {
  neutral: "bg-accent-active text-ink-2",
  accent: "bg-brand-tint text-brand-text",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

const opaques: Record<StatusPillTone, string> = {
  neutral: "bg-card border-border text-ink-2",
  accent: "bg-card border-brand-tint-line text-brand-text",
  success: "bg-card border-success/25 text-success",
  warning: "bg-card border-warning/25 text-warning",
  danger: "bg-card border-destructive/25 text-destructive",
};

const quietDots: Record<StatusPillTone, string> = {
  neutral: "bg-ink-4",
  accent: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

function StatusPill({
  tone = "neutral",
  dot = false,
  opaque = false,
  quiet = false,
  className,
  children,
  ...props
}: StatusPillProps) {
  const showDot = quiet || dot;
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 text-eyebrow font-medium whitespace-nowrap",
        quiet
          ? "text-ink-2"
          : cn("rounded-full px-2.5", opaque ? cn("border", opaques[tone]) : tints[tone]),
        className,
      )}
      {...props}
    >
      {showDot ? (
        <span
          aria-hidden
          className={cn("size-[5px] shrink-0 rounded-full", quiet ? quietDots[tone] : "bg-current")}
        />
      ) : null}
      {children}
    </span>
  );
}

export { StatusPill };
