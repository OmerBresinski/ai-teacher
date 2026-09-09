/** `@tj/editor/lesson` — the lesson editor shell and the pieces the app composes around it. */

export { AUTOSAVE_MS, SaveRefusedError, type SaveState } from "../model/use-autosave";
export { GUTTER, stepZoom, ZOOM_STEPS } from "./Canvas";
export { impactPreview, impactSentence, slidesReferencing } from "./impact-preview";
export { LessonEditor, type LessonEditorHandle, type LessonEditorProps } from "./LessonEditor";
export {
  NAVIGATOR_MODE_KEY,
  type NavigatorMode,
  navigatorThumbWidth,
  navigatorWidthVar,
  readNavigatorMode,
} from "./Navigator";
export { ALL_SHORTCUTS, HELP_GROUPS, type HelpShortcut, SHELL_SHORTCUTS } from "./shortcuts";
export { CropBar, type CropBarProps } from "./toolbar/CropToolbar";
export {
  CANVAS_SHORTCUTS,
  type CanvasShortcut,
  PASTE_IMAGE_EVENT,
  type PasteImageDetail,
} from "./transform/use-canvas-keys";
export { COALESCE_MS } from "./use-coalesced-ids";
export type { RegenerateTarget } from "./use-editor-session";
