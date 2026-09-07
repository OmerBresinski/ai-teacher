import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { DocumentSummary, Series } from "@tj/domain/documents";
import { queryKeys } from "./query";

/*
 * Optimistic edits over the library's cached lists (TanStack Query v5 `onMutate` pattern). A
 * write the teacher just performed — rename, delete, reorder — is applied to every cached page
 * that shows the row, so the screen answers at once; the server round trip and the invalidation
 * that follows only confirm it. Every edit returns a `rollback` that puts the snapshots back on
 * failure. Only lists and detail placeholders are touched here; a document body (the editor's
 * working copy, ADR 0022 §4) is the editor's to change.
 */

/** A list row as the API serves it; the two row-state columns ride beside the summary. */
export type SummaryRow = DocumentSummary & {
  deletedAt: string | null;
  generatingJobId: string | null;
};
export type SeriesItem = { series: Series; lessons: DocumentSummary[] };
type Page<T> = { items: T[]; nextCursor: string | null };

export type Rollback = () => void;

/** `null` from an edit removes the row. */
type Edit<T> = (row: T) => T | null;

function editPages<T>(data: InfiniteData<Page<T>> | undefined, edit: Edit<T>) {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((row) => {
        const next = edit(row);
        return next === null ? [] : [next];
      }),
    })),
  };
}

/** Snapshot every cached library entry; the returned function restores them all. */
function snapshot(queryClient: QueryClient): Rollback {
  const entries = queryClient.getQueriesData<unknown>({ queryKey: queryKeys.library });
  return () => {
    for (const [key, data] of entries) queryClient.setQueryData(key, data);
  };
}

/**
 * Apply `edit` to a document wherever a summary of it is cached: the document lists and each
 * series' lessons (cards and detail pages paint those). Cancel in-flight list fetches first so a
 * response that predates the write cannot land on top of it.
 */
export async function editDocumentSummaries(
  queryClient: QueryClient,
  edit: Edit<DocumentSummary>,
): Promise<Rollback> {
  await queryClient.cancelQueries({ queryKey: queryKeys.library });
  const rollback = snapshot(queryClient);
  queryClient.setQueriesData<InfiniteData<Page<SummaryRow>>>(
    { queryKey: queryKeys.libraryDocuments },
    (data) => editPages(data, (row) => edit(row) as SummaryRow | null),
  );
  const inSeries = (item: SeriesItem): SeriesItem => ({
    ...item,
    lessons: item.lessons.flatMap((lesson) => {
      const next = edit(lesson);
      return next === null ? [] : [next];
    }),
  });
  queryClient.setQueriesData<InfiniteData<Page<SeriesItem>>>(
    { queryKey: queryKeys.librarySeries },
    (data) => editPages(data, inSeries),
  );
  queryClient.setQueriesData<SeriesItem | null>(
    { queryKey: queryKeys.librarySeriesDetails },
    (item) => (item ? inSeries(item) : item),
  );
  return rollback;
}

/** Apply `edit` to a series wherever it is cached: the series lists and its detail entry. */
export async function editSeries(
  queryClient: QueryClient,
  edit: Edit<SeriesItem>,
): Promise<Rollback> {
  await queryClient.cancelQueries({ queryKey: queryKeys.library });
  const rollback = snapshot(queryClient);
  queryClient.setQueriesData<InfiniteData<Page<SeriesItem>>>(
    { queryKey: queryKeys.librarySeries },
    (data) => editPages(data, edit),
  );
  queryClient.setQueriesData<SeriesItem | null>(
    { queryKey: queryKeys.librarySeriesDetails },
    (item) => (item ? edit(item) : item),
  );
  return rollback;
}

/** Every document summary the loaded list pages hold, by id — the source for a reordered series' rows. */
export function cachedSummaryIndex(queryClient: QueryClient): Map<string, DocumentSummary> {
  const index = new Map<string, DocumentSummary>();
  for (const [, data] of queryClient.getQueriesData<InfiniteData<Page<SummaryRow>>>({
    queryKey: queryKeys.libraryDocuments,
  })) {
    for (const page of data?.pages ?? []) for (const row of page.items) index.set(row.id, row);
  }
  for (const [, data] of queryClient.getQueriesData<InfiniteData<Page<SeriesItem>>>({
    queryKey: queryKeys.librarySeries,
  })) {
    for (const page of data?.pages ?? []) {
      for (const item of page.items)
        for (const lesson of item.lessons) index.set(lesson.id, lesson);
    }
  }
  return index;
}

/** A series item with `series.lessonIds` replaced and its `lessons` re-derived from what is cached. */
export function withLessonIds(
  item: SeriesItem,
  lessonIds: string[],
  known: ReadonlyMap<string, DocumentSummary>,
): SeriesItem {
  const byId = new Map(item.lessons.map((lesson) => [lesson.id, lesson]));
  return {
    series: { ...item.series, lessonIds },
    lessons: lessonIds.flatMap((id) => byId.get(id) ?? known.get(id) ?? []),
  };
}
