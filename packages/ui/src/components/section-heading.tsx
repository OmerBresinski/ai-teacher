import type * as React from "react";

import { cn } from "../lib/cn";

export type SectionHeadingProps = React.ComponentProps<"div"> & {
  children: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
};

/*
 * A section heading is a label for a group of items, not a title: the UI face at 15/600 in
 * ink, the count beside it in ink-3. Lora stays on page titles, dialog titles, empty-state
 * headlines and `Display`; it does not reach section headings (owner ruling, 7 Sept 2026,
 * amending ruling 29's Lora 20 on Home).
 */
function SectionHeading({ children, count, action, className, ...props }: SectionHeadingProps) {
  return (
    <div className={cn("flex h-8 items-center justify-between gap-4", className)} {...props}>
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="truncate font-ui text-lead font-semibold text-foreground">{children}</h2>
        {count === undefined ? null : (
          <span className="shrink-0 text-meta font-medium text-ink-3 tabular-nums">{count}</span>
        )}
      </div>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}

export { SectionHeading };
