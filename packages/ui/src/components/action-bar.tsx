import type * as React from "react";

import { cn } from "../lib/cn";

/*
 * The sticky action bar under a step or a long form: paper background, a hairline above, one
 * labelled primary on the left with the quiet actions beside it, and a trailing slot (a keyboard
 * hint, a count) on the right. Sticks to the bottom of the viewport while its column scrolls, so
 * the exit stays in view however long the list gets. One primary per bar.
 */

export type ActionBarProps = React.ComponentProps<"div"> & {
  /** The one primary action; render a `Button` (its default variant, `size="lg"`). */
  primary: React.ReactNode;
  /** Quiet actions beside the primary. */
  children?: React.ReactNode;
  /** Right-aligned slot. */
  trailing?: React.ReactNode;
  /** Whether the bar sticks to the viewport bottom (default) or sits in flow. */
  sticky?: boolean;
};

function ActionBar({
  primary,
  children,
  trailing,
  sticky = true,
  className,
  ...props
}: ActionBarProps) {
  return (
    <div
      data-slot="action-bar"
      className={cn(
        "flex flex-wrap items-center gap-3 border-t border-border bg-background/95 py-3 backdrop-blur",
        sticky && "sticky bottom-0 z-10",
        className,
      )}
      {...props}
    >
      {primary}
      {children}
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}

export { ActionBar };
