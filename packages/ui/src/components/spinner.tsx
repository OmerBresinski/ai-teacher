import type * as React from "react";

import { cn } from "../lib/cn";

/*
 * Hand-written for @tj/ui on 2026-09-06 alongside shadcn@4.21.0 primitives.
 * Spinner is decorative-only, matching TeachDeck's pending-button treatment.
 * Two fixed sizes cover compact and default controls without introducing another token.
 */

function Spinner({
  className,
  size = 16,
  ...props
}: React.ComponentProps<"svg"> & { size?: 16 | 20 }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("motion-safe:animate-spin", size === 16 ? "size-4" : "size-5", className)}
      fill="none"
      viewBox="0 0 24 24"
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
    </svg>
  );
}

export { Spinner };
