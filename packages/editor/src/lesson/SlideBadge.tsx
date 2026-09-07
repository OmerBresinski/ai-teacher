import { cn, Tooltip } from "@tj/ui";

/*
 * The one navigator dot (ADR 0025 §12): the layout lint (`useSlideLint`, "needs Tidy") and the
 * residual findings share this shape so the rail has a single visual language for "look at this
 * slide". `warning` is the muted `--warning` token; `error` is `--destructive`. The dot is
 * focusable on purpose: its sentence is the only place the teacher is told why the slide is
 * flagged, and focus opens the tooltip for keyboard users.
 */

export type SlideBadgeTone = "warning" | "error";

export type SlideBadgeProps = {
  /** The teacher-readable sentence: tooltip and `aria-label`. */
  label: string;
  tone: SlideBadgeTone;
  /** A `data-*` hook for tests, e.g. `data-lint-badge` or `data-residual-badge`. */
  testAttribute: "data-lint-badge" | "data-residual-badge";
};

export function SlideBadge({ label, tone, testAttribute }: SlideBadgeProps) {
  return (
    <Tooltip label={label} side="right">
      <span
        role="img"
        aria-label={label}
        {...{ [testAttribute]: "" }}
        data-tone={tone}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the dot's sentence is the only place the teacher is told why the slide is flagged; focus opens its tooltip
        tabIndex={0}
        className={cn(
          "block size-2 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          tone === "error" ? "bg-destructive" : "bg-warning",
        )}
      />
    </Tooltip>
  );
}
