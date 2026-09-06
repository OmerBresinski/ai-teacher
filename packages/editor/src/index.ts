/**
 * `@tj/editor` — root barrel (ADR 0022). Model helpers, static text rendering and the slide
 * renderer. Editor surfaces (`./lesson`, `./present`, `./worksheet`, `./export`) get their own
 * subpaths as they land; the library's thumbnail path is `./thumb`.
 */
export * from "./layout/explanation";
export * from "./layout/reflow";
export * from "./model/demo-worksheet";
export * from "./model/factories";
export * from "./model/fonts";
export * from "./model/geometry";
export * from "./model/grid";
export * from "./model/images";
export * from "./model/insert";
export * from "./model/layouts";
export * as reducers from "./model/reducers";
export * from "./model/starter";
export * from "./model/themes";
export {
  type AnyReducer,
  type DocumentHistory,
  type DocumentHistoryOptions,
  HISTORY_LIMIT,
  type ReducerResult,
  useDocumentHistory,
} from "./model/use-document-history";
export * from "./model/worksheet-factories";
export * from "./slide/elements";
export { SlideScaler, useSlideScale } from "./slide/SlideScaler";
export {
  SlideFluid,
  type SlideFluidProps,
  SlideStatic,
  type SlideStaticProps,
} from "./slide/SlideStatic";
export { type SlideMode, SlideView, type SlideViewProps } from "./slide/SlideView";
export * from "./text/extensions";
export * from "./text/static";
