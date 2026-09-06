/*
 * Document theme fonts (ADR 0022 §7). The eleven families TeachDeck loads with
 * `next/font/google` (`lib/fonts.ts:69-100`) are self-hosted here through `@fontsource`;
 * `src/styles/fonts.css` defines the `--font-*` variables these stacks read. No Google Fonts
 * requests, CSP unchanged (ADR 0019 §2).
 */

/** Family stacks for themes and the font picker. */
export const FONT_STACKS = {
  lexend: 'var(--font-lexend), "Trebuchet MS", sans-serif',
  gabarito: "var(--font-gabarito), Verdana, sans-serif",
  figtree: "var(--font-figtree), Verdana, sans-serif",
  sourceSerif: "var(--font-source-serif), Georgia, serif",
  schibsted: 'var(--font-schibsted), "Helvetica Neue", sans-serif',
  literata: "var(--font-literata), Georgia, serif",
  publicSans: 'var(--font-public-sans), "Helvetica Neue", sans-serif',
  bricolage: 'var(--font-bricolage), "Helvetica Neue", sans-serif',
  instrumentSans: 'var(--font-instrument-sans), "Helvetica Neue", sans-serif',
  atkinson: "var(--font-atkinson), Verdana, sans-serif",
  geist: 'var(--font-geist), ui-sans-serif, -apple-system, "Segoe UI", sans-serif',
} as const;

export type FontKey = keyof typeof FONT_STACKS;

export const FONT_LABELS: Record<FontKey, string> = {
  lexend: "Lexend",
  gabarito: "Gabarito",
  figtree: "Figtree",
  sourceSerif: "Source Serif",
  schibsted: "Schibsted Grotesk",
  literata: "Literata",
  publicSans: "Public Sans",
  bricolage: "Bricolage Grotesque",
  instrumentSans: "Instrument Sans",
  atkinson: "Atkinson Hyperlegible",
  geist: "Geist",
};
