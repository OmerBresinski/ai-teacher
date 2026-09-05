import type * as React from "react";

import { cn } from "../lib/cn";

import { Display } from "./display";

export type EmptyStateProps = React.ComponentProps<"div"> & {
  icon?: React.ReactNode;
  iconTone?: "accent" | "quiet";
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  as?: "h2" | "h3" | "h4";
  stacked?: boolean;
  surface?: boolean;
};

function EmptyState({
  icon,
  iconTone = "accent",
  title,
  body,
  action,
  secondaryAction,
  as = "h2",
  stacked = false,
  surface = true,
  className,
  ...props
}: EmptyStateProps) {
  const sheets = stacked && surface;
  return (
    <div
      className={cn(
        "px-8 pb-9 pt-8",
        sheets && "relative isolate",
        surface && "max-w-[520px] rounded-dialog bg-card shadow-1",
        className,
      )}
      {...props}
    >
      {sheets ? (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-1 translate-x-1.5 translate-y-1.5 rounded-dialog bg-card shadow-1"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-2 translate-x-3 translate-y-3 rounded-dialog bg-card shadow-1"
          />
        </>
      ) : null}
      {icon ? (
        <div
          aria-hidden
          className={cn(
            "mb-4 flex size-10 items-center justify-center rounded-full [&_svg]:size-5",
            iconTone === "accent" ? "bg-brand-tint text-brand-text" : "text-ink-4",
          )}
        >
          {icon}
        </div>
      ) : null}
      <Display as={as as "h2"} size="md">
        {title}
      </Display>
      {body ? <div className="mt-2 max-w-[46ch] text-body text-ink-2">{body}</div> : null}
      {action || secondaryAction ? (
        <div className="mt-6 flex items-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

export { EmptyState };
