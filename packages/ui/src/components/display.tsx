import type * as React from "react";

import { cn } from "../lib/cn";

/*
 * `font-display` (Lora 500) appears only here and on `DialogTitle`/`AlertDialogTitle`; never
 * below 20px (ADR 0019 §2). Where it lands: page titles (lg, 28), dialog titles (sm, 20),
 * empty-state headlines (sm), the wordmark (md, 22) and the sign-in cover (xl, 36). It does
 * not reach section headings, bars, controls or labels; those are the UI face.
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
  lg: "text-[28px] leading-9 tracking-[-0.015em]",
  xl: "text-[36px] leading-[44px] tracking-[-0.02em]",
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
