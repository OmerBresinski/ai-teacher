import { cn } from "@tj/ui";
import type { ComponentProps } from "react";

/*
 * Plan, the open-book character of the DayBack cast (TEACH-252). A static React port of the
 * `support` SVG in homepage/motion/characters.js, copied, not redrawn. The homepage styles it
 * with `.site-character svg` (homepage/assets/system.css); those styles are attributes here:
 * 2.1 strokes, 3 on the limbs. `happy-mouth` is dropped because the homepage hides it. The
 * paper fills are artwork. No GSAP and no cast rig: it never moves. Hidden from assistive
 * technology, like every homepage character wrapper.
 *
 * Two inks, because the app has dark themes and the homepage does not: the limbs are drawn on
 * the page, so they follow `currentColor`; the book, its lines and its face are drawn on light
 * paper, so they keep the homepage's ink (#293b32) in every theme. On `currentColor` alone a
 * dark theme would draw the face in near-white on pale sage and it would disappear.
 */
export function PlanCharacter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div aria-hidden="true" className={cn("w-[230px] text-foreground", className)} {...props}>
      {PLAN}
    </div>
  );
}

// Static artwork hoisted so a re-render never rebuilds it (rendering-hoist-jsx).
const PLAN = (
  <svg
    aria-hidden="true"
    focusable="false"
    className="block w-full overflow-visible"
    viewBox="0 0 300 300"
    stroke="currentColor"
    fill="none"
    strokeWidth={2.1}
    strokeLinejoin="round"
    strokeLinecap="round"
  >
    <path d="m91 229-9 40-19 2M198 228l9 40 18 4" strokeWidth={3} />
    <path d="M57 143q-21 27-40 8" strokeWidth={3} />
    <path d="M237 144q22 28 44 4" strokeWidth={3} />
    <g stroke="#293b32">
      <path d="m49 83 99-10 96 18-8 143-92-9-87 11Z" fill="#80956f" />
      <path d="m52 77 93-9 92 17-8 140-84-10-85 14Z" fill="#d6e2bd" />
      <path d="m145 68 0 147" />
      <path d="m70 102 55-5M72 113l42-4M165 98l48 9M165 109l37 8" />
      <circle cx="116" cy="142" r="3" fill="#293b32" />
      <circle cx="171" cy="145" r="3" fill="#293b32" />
      <path d="M129 158q14 11 27 2" />
      <path d="m77 194 40-4M168 190l34 6" />
    </g>
  </svg>
);
