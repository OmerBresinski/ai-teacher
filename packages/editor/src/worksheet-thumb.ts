/**
 * `@tj/editor/worksheet-thumb` — the static worksheet render the library imports for card
 * thumbnails (UX ruling 31; ADR 0022 §8). Like `./thumb`, nothing here may reach Tiptap's React
 * editor, ProseMirror's view or any editing module; `thumb.test.ts` builds this entry and checks.
 */
export { DEFAULT_THEME_ID, getTheme, THEMES } from "./model/themes";
export { WorksheetThumb, type WorksheetThumbProps } from "./worksheet/WorksheetThumb";
