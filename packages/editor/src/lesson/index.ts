/** `@tj/editor/lesson` — the lesson editor shell and the pieces the app composes around it. */

export { AUTOSAVE_MS, SaveRefusedError, type SaveState } from "../model/use-autosave";
export { clearShift, GUTTER, stepZoom, ZOOM_STEPS } from "./Canvas";
export { impactPreview, impactSentence, slidesReferencing } from "./impact-preview";
export { LessonEditor, type LessonEditorHandle, type LessonEditorProps } from "./LessonEditor";
export { MobileSlideList } from "./MobileSlideList";
export {
  FILMSTRIP_THUMB_WIDTH,
  NAVIGATOR_MODE_KEY,
  type NavigatorMode,
  navigatorThumbWidth,
  navigatorWidthVar,
  readFilmstripDots,
  readNavigatorMode,
} from "./Navigator";
export type { PromptEditAnswer, PromptEditPartial, PromptEditRequest } from "./proposals-context";
export {
  SidePaneDock,
  type SidePaneDockProps,
  sidePaneClass,
  usePaneWidth,
} from "./SidePaneDock";
export { type PaneMode, paneMode, paneWidth } from "./shell-layout";
export { ALL_SHORTCUTS, HELP_GROUPS, type HelpShortcut, SHELL_SHORTCUTS } from "./shortcuts";
export {
  displayInTheme,
  GeneratingThemeDialog,
  ThemeCallout,
  ThemeDialog,
} from "./ThemeDialog";
export { CropBar, type CropBarProps } from "./toolbar/CropToolbar";
export {
  CANVAS_SHORTCUTS,
  type CanvasShortcut,
  PASTE_IMAGE_EVENT,
  type PasteImageDetail,
} from "./transform/use-canvas-keys";
export { COALESCE_MS } from "./use-coalesced-ids";
export { useCompactChrome } from "./use-compact-chrome";
export type { RegenerateTarget } from "./use-editor-session";
export { useMobileEditor } from "./use-mobile-editor";
