import type * as React from "react";

import { cn } from "../lib/cn";

/*
 * The ONLY component allowed to use `font-display`. Lora is loaded at 500 and
 * never appears below its 20px floor; app-bar and card titles use font-ui.
 */

export type DisplaySize = "sm" | "md" | "lg" | "xl";

export type DisplayProps = React.HTMLAttributes<HTMLElement> & {
  as?: "h1" | "h2" | "h3" | "span";
  size?: DisplaySize;
  children: React.ReactNode;
};

const sizes: Record<DisplaySize, string> = {
  sm: "text-[20px] leading-7",
  md: "text-[22px] leading-[30px]",
  lg: "text-[28px] leading-9",
  xl: "text-[36px] leading-[44px]",
};

function Display({ as: Comp = "h2", size = "md", className, children, ...props }: DisplayProps) {
  return (
    <Comp
      className={cn(
        "font-display font-medium tracking-[-0.01em] text-foreground",
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  );
}

export { Display };
