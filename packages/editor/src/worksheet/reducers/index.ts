/**
 * Pure worksheet reducers (ADR 0022 §4) — TeachDeck's `worksheet-store.ts` document actions, one
 * function each, `(worksheet, ...args) => Worksheet` or `=> { worksheet, id }`. Apply them through
 * `useWorksheetHistory` to get undo/redo and transactions over the TanStack Query cache. The UI half
 * of the store (`select`, `markSaved`) is session state in the worksheet editor, not a reducer.
 */

export * from "./blocks";
export type { WithId } from "./core";
export * from "./criteria";
export * from "./sheet";
