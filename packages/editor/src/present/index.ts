/** `@tj/editor/present` — the read-only viewer and present mode. */

// Stored lessons behind the current fit are re-fitted in memory before these draw them.
export { storedSlideId, useFittedLesson } from "../layout/refit";
export type { NextLesson } from "./EndCard";
export { LessonViewer, type LessonViewerProps, type PendingSlide } from "./LessonViewer";
export { type PresentProgress, PresentView, type PresentViewProps } from "./PresentView";
export { PRESENT_SHORTCUT_GROUPS, PRESENT_SHORTCUTS, type PresentShortcut } from "./shortcuts";
