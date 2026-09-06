/**
 * Pure lesson reducers (ADR 0022 §4) — TeachDeck's `lesson-store.ts` document actions, one
 * function each, `(lesson, ...args) => Lesson` or `=> { lesson, id(s) }`. Apply them through
 * `useDocumentHistory` to get undo/redo and transactions over the TanStack Query cache.
 */

export * from "./arrange";
export {
  findElement,
  isSilentReducer,
  SILENT,
  type SilentReducer,
  type WithId,
} from "./core";
export * from "./elements";
export * from "./lesson";
export * from "./question";
export * from "./slides";
