/**
 * The chrome `/sign-in` and `/sign-in/confirm` share (TEACH-246): the paper glow behind the page
 * and the brand lockup in its corner. Static JSX, hoisted so a state change never rebuilds it.
 */
import { Display } from "@tj/ui";
import { DaybackMark } from "./dayback-mark";

/** The homepage hero's paper glow (homepage/assets/hero.css `.hm-hero-band`), on tokens. */
export const PAPER_GLOW = (
  <div
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_60%_50%,var(--card)_0,transparent_65%)]"
  />
);

/** The brand lockup: not a link, so it adds no tab stop before the page's first control. */
export const SIGN_IN_LOCKUP = (
  <Display as="span" size="md" className="inline-flex items-center gap-[0.2em] whitespace-nowrap">
    <span className="inline-flex origin-[50%_52%] motion-safe:animate-dayback-rewind">
      <DaybackMark />
    </span>
    DayBack
  </Display>
);
