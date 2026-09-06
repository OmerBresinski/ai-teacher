/**
 * `@tj/editor/thumb` — the static slide render the library imports for thumbnails (ADR 0022
 * §8). Nothing here may reach Tiptap's React editor, ProseMirror's view or any editing module;
 * `thumb.test.ts` builds this entry and checks.
 */
export { DEFAULT_THEME_ID, getTheme, THEMES } from "./model/themes";
export {
  SlideFluid,
  type SlideFluidProps,
  SlideStatic,
  type SlideStaticProps,
} from "./slide/SlideStatic";
