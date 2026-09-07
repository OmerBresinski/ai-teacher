import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { DocumentSummary, Series } from "@tj/domain/documents";
import { queryKeys } from "./query";

/*
 * Optimistic edits over the library's cached lists (TanStack Query v5 `onMutate` pattern). A
 * write the teacher just performed — rename, delete, reorder — is applied to every cached page
 * that shows the row, so the screen answers at once; the server round trip and the invalidation
 * that follows only confirm it. Every edit returns a `rollback` that puts the snapshots back on
 * failure. Only lists and detail entries are touched — and only those are cancelled and
 * snapshotted, so an editor's in-flight body fetch or working copy (ADR 0022 §4) is never
 * disturbed by a library write.
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

/** The keys an optimistic edit may touch: the document lists, the series lists, series details. */
const LIST_KEYS = [
  queryKeys.libraryDocuments,
  queryKeys.librarySeries,
  queryKeys.librarySeriesDetails,
] as const;

/**
 * Cancel in-flight list fetches (a response that predates the write must not land on top of it)
 * and snapshot the list entries. The returned `rollback` restores them — unless another library
 * write is still in flight, in which case the snapshot may predate that write's own edit and
 * restoring it would undo work the server has accepted; the settle-time invalidation reconciles
 * both instead. (`isMutating` still counts the failing mutation while its `onError` runs.)
 */
async function prepare(queryClient: QueryClient): Promise<Rollback> {
  await Promise.all(LIST_KEYS.map((queryKey) => queryClient.cancelQueries({ queryKey })));
  const entries = LIST_KEYS.flatMap((queryKey) =>
    queryClient.getQueriesData<unknown>({ queryKey }),
  );
  return () => {
    if (queryClient.isMutating() > 1) return;
    for (const [key, data] of entries) queryClient.setQueryData(key, data);
  };
}

/**
 * Apply `edit` to a document wherever a summary of it is cached: the document lists and each
 * series' lessons (cards and detail pages paint those).
 */
export async function editDocumentSummaries(
  queryClient: QueryClient,
  edit: Edit<DocumentSummary>,
): Promise<Rollback> {
  const rollback = await prepare(queryClient);
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
  const rollback = await prepare(queryClient);
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
