/*
 * Present-mode geometry and one-off mixes (TeachDeck `components/v2/present/stage-tokens.ts`).
 * The palette itself is the `.tj-stage` scope in `@tj/ui/styles/globals.css` (ADR 0022 §3): put
 * `STAGE_SCOPE_CLASS` on the present root and every `@tj/ui` control inside paints itself for the
 * stage. A portalled surface (menu, popover, dialog) carries the class itself.
 */

export const STAGE_SCOPE_CLASS = "tj-stage";

/**
 * The two floating pills — the controls and the timer readout — are the one place a blur is
 * allowed: they sit over a slide that may be any colour, and an opaque chip there reads as a hole
 * punched in the picture. 88 percent of the stage surface.
 */
export const STAGE_PILL_STYLE = {
  background: "color-mix(in srgb, var(--card) 88%, transparent)",
  backdropFilter: "blur(8px)",
} as const;

/** A dot, a ring or a wash at N percent paper (the stage foreground). */
export function paper(percent: number): string {
  return `color-mix(in srgb, var(--foreground) ${percent}%, transparent)`;
}

/** N percent of the ground: scrims and washes, warm rather than neutral black. */
export function ground(percent: number): string {
  return `color-mix(in srgb, var(--background) ${percent}%, transparent)`;
}
