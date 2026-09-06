/** `@tj/editor/lesson` — the lesson editor shell and the pieces the app composes around it. */

export { GUTTER, stepZoom, ZOOM_STEPS } from "./Canvas";
export { LessonEditor, type LessonEditorProps } from "./LessonEditor";
export { ALL_SHORTCUTS, HELP_GROUPS, type HelpShortcut, SHELL_SHORTCUTS } from "./shortcuts";
export {
  CANVAS_SHORTCUTS,
  type CanvasShortcut,
  PASTE_IMAGE_EVENT,
  type PasteImageDetail,
} from "./transform/use-canvas-keys";
export { AUTOSAVE_MS, type SaveState } from "./use-autosave";
