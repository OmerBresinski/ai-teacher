// Moved to `@tj/slides` (TEACH-28) so `materialiseSlide` can fit a slide before it is stored.
// Re-exported here, with the metrics its callers took from this path, so every `./reflow` import
// in the editor keeps resolving.
export { OPTION, SAFE_BOTTOM, SAFETY, withSafety } from "@tj/slides";
export * from "@tj/slides/reflow";
