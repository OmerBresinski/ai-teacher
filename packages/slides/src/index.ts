/**
 * `@tj/slides` — the pure slide recipes (ADR 0025 §9). The theme catalogue and projector floors,
 * the 960x540 grid, `layoutSlide` and its placeholder copy, the rich-doc builders, text-style
 * resolution and the panel metrics the recipes lay out against, plus `materialiseSlide` /
 * `materialiseBlock`, which fill a recipe from a model-produced spec (ADR 0025 §8), and the
 * worksheet recipes with their factories, word search and time-on-task rule (ADR 0030 item 4).
 *
 * Depends on `@tj/domain`, `nanoid` and `zod` only: no React, no Tiptap, no CSS. `@tj/editor`
 * re-exports everything here from its previous paths; `@tj/generation` imports it directly.
 * `bundle.test.ts` holds the line.
 */

export * from "./choose-variant";
export * from "./demo-lesson";
export * from "./explanation-metrics";
export * from "./factories";
export * from "./fit-slide";
export * from "./fonts";
export * from "./geometry";
export * from "./grid";
export * from "./layouts";
export * from "./materialise";
export * from "./metrics";
export * from "./path";
export * from "./reflow";
export * from "./specs";
export * from "./text-measure";
export * from "./text-style";
export * from "./themes";
export * from "./worksheet";
