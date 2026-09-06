import type * as React from "react";

import { cn } from "../lib/cn";

export type TileProps = Omit<React.ComponentProps<"button">, "children"> & {
  children: string;
  icon: React.ReactNode;
  tone?: "default" | "primary";
};

function Tile({ children, icon, tone = "default", className, type, ...props }: TileProps) {
  const primary = tone === "primary";
  return (
    <button
      type={type ?? "button"}
      data-primary-fill={primary ? "" : undefined}
      className={cn(
        "group flex h-16 w-full items-center justify-start gap-3 rounded-card px-5 text-left text-lead font-semibold outline-none motion-safe:transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        primary
          ? "bg-primary-fill text-primary-foreground hover:bg-primary-fill-hover active:bg-primary-fill-press"
          : "border border-border-control/40 bg-card text-foreground hover:bg-accent active:bg-accent-active",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-control [&_svg]:size-6",
          primary ? "bg-white/15 text-primary-foreground" : "bg-brand-quiet text-brand-text",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate" data-primary-fill={primary ? "" : undefined}>
        {children}
      </span>
    </button>
  );
}

export { Tile };
