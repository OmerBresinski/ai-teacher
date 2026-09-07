/**
 * The lesson editor's history: `useHistory` (`./use-history.ts`, one implementation of undo/redo
 * and transactions over the TanStack Query cache, ADR 0022 §4) specialised to `Lesson`. The
 * worksheet twin is `worksheet/use-worksheet-history.ts`.
 */

import type { QueryFunction, QueryKey } from "@tanstack/react-query";
import type { Lesson } from "@tj/domain/documents";
import { useMemo } from "react";
import { HISTORY_LIMIT, type History, type ReducerOf, useHistory } from "./use-history";

export { HISTORY_LIMIT };

/** A reducer result: the next lesson, or the next lesson plus the id(s) it minted. */
export type ReducerResult = Lesson | { lesson: Lesson };

export type AnyReducer = ReducerOf<Lesson, ReducerResult>;

export type DocumentHistoryOptions<TData = unknown> = {
  /** The cache entry that holds the document (e.g. `queryKeys.libraryDocument(id)`). */
  queryKey: QueryKey;
  /**
   * The query's fetcher; the cache entry may hold a summary or `null` until it resolves. Optional
   * because `queryOptions()` types its own as optional — the route loader has filled the cache.
   */
  queryFn?: QueryFunction<TData, QueryKey>;
  /** Called after every committed change — once per transaction, not per dispatch inside it. */
  onChange?: (lesson: Lesson) => void;
};

export type DocumentHistory = Omit<History<Lesson, ReducerResult>, "document"> & {
  /** The lesson in the cache, or `undefined` while it is loading / not a lesson. */
  lesson: Lesson | undefined;
};

/**
 * Shape check, not `isLesson` from `@tj/domain/documents`: that one runs the Zod schema and this
 * runs on every render and every dispatch of a drag. The cache holds a lesson, a worksheet, a
 * summary or `null`; only a lesson has `slides`.
 */
export function isLessonData(data: unknown): data is Lesson {
  return (
    typeof data === "object" &&
    data !== null &&
    "version" in data &&
    "slides" in data &&
    Array.isArray((data as { slides: unknown }).slides)
  );
}

const lessonOf = (result: ReducerResult): Lesson => ("slides" in result ? result : result.lesson);

export function useDocumentHistory<TData = unknown>({
  queryKey,
  queryFn,
  onChange,
}: DocumentHistoryOptions<TData>): DocumentHistory {
  const history = useHistory<Lesson, ReducerResult, TData>({
    queryKey,
    queryFn,
    onChange,
    isDocument: isLessonData,
    documentOf: lessonOf,
  });
  // `history` is already memoised on its parts; this only renames `document` → `lesson`.
  return useMemo(() => {
    const { document: lesson, ...rest } = history;
    return { lesson, ...rest };
  }, [history]);
}
