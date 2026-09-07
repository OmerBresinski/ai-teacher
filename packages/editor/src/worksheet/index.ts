/**
 * `@tj/editor/worksheet` — the worksheet model and its static renderer (ADR 0022, 0023 §2): pure
 * pagination / metrics / answer-key / word-search modules, the reducers and history hook, the
 * `Sheet` renderer and the `WorksheetPrint` layout. The editing surface is `@tj/editor/worksheet-editor`
 * (its own entry, so this one never pulls Tiptap into the print chunk). The page that mounts
 * `WorksheetPrint` imports `@tj/editor/styles/print.css`.
 */

export * from "./answers";
export {
  AnswerKeyEntry,
  AnswerKeyTitle,
  BlockContent,
  CriteriaList,
  FlowItemContent,
  RagStrip,
  SheetHeader,
  type SheetMode,
  SheetText,
  type StemRenderer,
} from "./BlockContent";
export * from "./block-types";
export { type SheetPagination, useSheetPagination } from "./measure";
export * from "./metrics";
export * from "./paginate";
export * as worksheetReducers from "./reducers";
export { flowItemClass, PageView, Sheet, sheetVars } from "./Sheet";
export {
  type AnyWorksheetReducer,
  isWorksheetData,
  useWorksheetHistory,
  type WorksheetHistory,
  type WorksheetHistoryOptions,
  type WorksheetReducerResult,
} from "./use-worksheet-history";
export { WordSearchView } from "./WordSearch";
export { WorksheetPrint, type WorksheetPrintProps } from "./WorksheetPrint";
export * from "./word-search";
