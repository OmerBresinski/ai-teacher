/**
 * `@tj/editor/worksheet-editor` — the worksheet editing surface (TEACH-109). A separate entry from
 * `@tj/editor/worksheet` for the same reason `lesson` is separate from `present` (ADR 0022 §8): the
 * print route mounts the static sheet and must never pull Tiptap, the toolbars or the typing session
 * into its chunk. The page that mounts `WorksheetEditor` imports `@tj/editor/styles/worksheet-edit.css`.
 */

export { type TypingSession, useTypingSessionState } from "./typing-session";
export {
  type CaretIntent,
  useWorksheetSessionState,
  type WorksheetSession,
} from "./use-worksheet-session";
export { WorksheetEditor, type WorksheetEditorProps } from "./WorksheetEditor";
