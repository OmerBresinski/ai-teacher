import type * as React from "react";

import { cn } from "../lib/cn";

import { Display } from "./display";

export type SectionHeadingProps = React.ComponentProps<"div"> & {
  children: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
};

function SectionHeading({ children, count, action, className, ...props }: SectionHeadingProps) {
  return (
    <div className={cn("flex h-8 items-center justify-between gap-4", className)} {...props}>
      <div className="flex min-w-0 items-baseline gap-2">
        <Display as="h2" size="sm" className="truncate">
          {children}
        </Display>
        {count === undefined ? null : (
          <span className="shrink-0 text-meta text-ink-3 tabular-nums">{count}</span>
        )}
      </div>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}

export { SectionHeading };
