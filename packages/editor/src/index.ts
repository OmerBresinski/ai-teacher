/**
 * `@tj/editor` — root barrel (ADR 0022). Model helpers, static text rendering and the slide
 * renderer. Editor surfaces (`./lesson`, `./present`, `./worksheet`, `./export`) get their own
 * subpaths as they land; the library's thumbnail path is `./thumb`.
 */
export * from "./layout/explanation";
export * from "./layout/reflow";
export * from "./model/factories";
export * from "./model/fonts";
export * from "./model/geometry";
export * from "./model/grid";
export * from "./model/layouts";
export * from "./model/themes";
export * from "./slide/elements";
export { SlideScaler, useSlideScale } from "./slide/SlideScaler";
export { SlideStatic, type SlideStaticProps } from "./slide/SlideStatic";
export { type SlideMode, SlideView, type SlideViewProps } from "./slide/SlideView";
export * from "./text/extensions";
export * from "./text/static";
