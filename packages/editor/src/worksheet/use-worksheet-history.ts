/**
 * The worksheet editor's history: `useHistory` (`model/use-history.ts`) specialised to
 * `Worksheet`. Same undo/redo/transaction contract as `useDocumentHistory`, over the same Query
 * cache entry the route loader filled (ADR 0022 §4).
 */

import type { QueryFunction, QueryKey } from "@tanstack/react-query";
import type { Worksheet } from "@tj/domain/documents";
import { useMemo } from "react";
import { type History, type ReducerOf, useHistory } from "../model/use-history";

/** A reducer result: the next worksheet, or the next worksheet plus the id it minted. */
export type WorksheetReducerResult = Worksheet | { worksheet: Worksheet };

export type AnyWorksheetReducer = ReducerOf<Worksheet, WorksheetReducerResult>;

export type WorksheetHistoryOptions<TData = unknown> = {
  /** The cache entry that holds the document (e.g. `queryKeys.libraryDocument(id)`). */
  queryKey: QueryKey;
  /** The query's fetcher; optional because the route loader has filled the cache. */
  queryFn?: QueryFunction<TData, QueryKey>;
  /** Called after every committed change — once per transaction, not per dispatch inside it. */
  onChange?: (worksheet: Worksheet) => void;
};

export type WorksheetHistory = Omit<History<Worksheet, WorksheetReducerResult>, "document"> & {
  /** The worksheet in the cache, or `undefined` while it is loading / not a worksheet. */
  worksheet: Worksheet | undefined;
};

/**
 * Shape check, not `isWorksheet` from `@tj/domain/documents` (the Zod schema): this runs on every
 * render and dispatch. The cache holds a lesson, a worksheet, a summary or `null`; only a worksheet
 * has `blocks`.
 */
export function isWorksheetData(data: unknown): data is Worksheet {
  return (
    typeof data === "object" &&
    data !== null &&
    "version" in data &&
    "blocks" in data &&
    Array.isArray((data as { blocks: unknown }).blocks)
  );
}

const worksheetOf = (result: WorksheetReducerResult): Worksheet =>
  "blocks" in result ? result : result.worksheet;

export function useWorksheetHistory<TData = unknown>({
  queryKey,
  queryFn,
  onChange,
}: WorksheetHistoryOptions<TData>): WorksheetHistory {
  const history = useHistory<Worksheet, WorksheetReducerResult, TData>({
    queryKey,
    queryFn,
    onChange,
    isDocument: isWorksheetData,
    documentOf: worksheetOf,
  });
  return useMemo(() => {
    const { document: worksheet, ...rest } = history;
    return { worksheet, ...rest };
  }, [history]);
}
