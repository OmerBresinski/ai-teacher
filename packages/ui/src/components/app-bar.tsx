import type * as React from "react";

import { cn } from "../lib/cn";

export type AppBarProps = React.ComponentProps<"header"> & {
  maxWidth?: number;
};

function AppBar({ children, className, maxWidth, ...props }: AppBarProps) {
  const content = maxWidth ? (
    <div className="mx-auto flex h-full w-full items-center gap-2" style={{ maxWidth }}>
      {children}
    </div>
  ) : (
    children
  );

  return (
    <header
      className={cn("flex h-12 items-center gap-2 border-b border-border bg-card px-3", className)}
      {...props}
    >
      {content}
    </header>
  );
}

function AppBarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 items-center gap-1", className)} {...props} />;
}

function AppBarTitle({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("truncate text-lead font-semibold", className)} {...props} />;
}

export { AppBar, AppBarGroup, AppBarTitle };
