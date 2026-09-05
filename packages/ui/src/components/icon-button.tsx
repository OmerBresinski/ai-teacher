import * as React from "react";

import { cn } from "../lib/cn";

import { Tooltip } from "./tooltip";

export type IconButtonProps = React.ComponentProps<"button"> & {
  label: string;
  size?: "sm" | "md";
  active?: boolean;
  noTooltip?: boolean;
};

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", active = false, noTooltip = false, className, type, ...props },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-control text-ink-2 outline-none motion-safe:transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "size-6" : "size-8",
        active && "bg-accent-active text-foreground",
        className,
      )}
      {...props}
    />
  );

  return noTooltip ? button : <Tooltip label={label}>{button}</Tooltip>;
});

function IconGroup({
  className,
  ...props
}: React.ComponentProps<"fieldset"> & { "aria-label": string }) {
  return (
    <fieldset
      className={cn(
        "inline-flex gap-0.5 rounded-control border border-border bg-card p-0.5",
        className,
      )}
      {...props}
    />
  );
}

export { IconButton, IconGroup };
