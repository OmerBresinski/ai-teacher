import { cn } from "@tj/ui";
import type { ComponentProps } from "react";

/*
 * The DayBack mark (TEACH-252): a yellow sun inside an undo arrow that turns back anticlockwise.
 * A React port of `brandMark` in homepage/src/components.mjs, copied, not redrawn: same viewBox
 * and paths, the sun's yellow is artwork, the ring and arrow follow `currentColor`. Sized in `em`
 * like the homepage's `.brand-mark` (homepage/assets/system.css), so it scales with the word it
 * sits beside. Decorative, like @tj/ui Spinner: the word "DayBack" next to it names the brand.
 * The sun sits at (24, 25), so a wrapper that rotates about 50% 52% turns the ring round it.
 */
export function DaybackMark({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={cn("size-[1.08em] shrink-0 overflow-visible", className)}
      viewBox="0 0 48 48"
      {...props}
    >
      {MARK}
    </svg>
  );
}

// Static artwork hoisted so a re-render never rebuilds it (rendering-hoist-jsx).
const MARK = (
  <>
    <circle cx="24" cy="25" r="7.5" fill="#f5c054" />
    <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.49 10.87A16 16 0 1 0 31.51 10.87" fill="none" strokeWidth="4.2" />
      <path d="M25.07 7.45 35.01 6.84 30.13 16.03Z" fill="currentColor" strokeWidth="1.4" />
    </g>
  </>
);
