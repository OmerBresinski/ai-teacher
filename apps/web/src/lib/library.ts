import type { QueryClient, UseMutationOptions } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import type { DocumentSummary, SeriesWithLessons } from "@/mocks/library-schema";
import {
  addLessonsToSeries,
  createDocument,
  createSeries,
  duplicateDocument,
  duplicateSeries,
  listDocuments,
  listSeriesWithLessons,
  loadDocument,
  loadSeriesWithLessons,
  removeLessonFromSeries,
  renameDocument,
  renameSeries,
  restoreDocument,
  restoreSeries,
  setSeriesLessons,
  softDeleteDocument,
  softDeleteSeries,
} from "@/mocks/library-store";
import { queryKeys } from "./query";

/**
 * Query options for the library (ADR 0020). Lists are the source of truth; the per-entity options
 * exist so route loaders, hover preloads and detail pages ask for exactly one record — the shape
 * the real API will serve. Until then `placeholderData` seeds a detail from the cached list so a
 * card → detail navigation paints immediately and the detail fetch settles behind it.
 */
export const libraryQueries = {
  documents: () => queryOptions({ queryKey: queryKeys.libraryDocuments, queryFn: listDocuments }),
  document: (id: string, queryClient?: QueryClient) =>
    queryOptions({
      queryKey: queryKeys.libraryDocument(id),
      queryFn: () => loadDocument(id),
      placeholderData: () =>
        queryClient
          ?.getQueryData<DocumentSummary[]>(queryKeys.libraryDocuments)
          ?.find((document) => document.id === id),
    }),
  series: () => queryOptions({ queryKey: queryKeys.librarySeries, queryFn: listSeriesWithLessons }),
  seriesDetail: (id: string, queryClient?: QueryClient) =>
    queryOptions({
      queryKey: queryKeys.librarySeriesDetail(id),
      queryFn: () => loadSeriesWithLessons(id),
      placeholderData: () =>
        queryClient
          ?.getQueryData<SeriesWithLessons[]>(queryKeys.librarySeries)
          ?.find((item) => item.series.id === id),
    }),
};

/** `select` helpers: subscribe components to the slice they render, not the whole list. */
export const librarySelectors = {
  byKind: (kind: DocumentSummary["kind"]) => (documents: DocumentSummary[]) =>
    documents.filter((document) => document.kind === kind),
  countsByKind: (documents: DocumentSummary[]): Record<DocumentSummary["kind"], number> => {
    const counts = { lesson: 0, worksheet: 0 };
    for (const document of documents) counts[document.kind] += 1;
    return counts;
  },
  length: (items: unknown[]): number => items.length,
};

export type LibraryDocumentsQuery = ReturnType<typeof libraryQueries.documents>;

function invalidateLibrary(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.library });
}

export const libraryMutations = {
  createDocument: (
    queryClient: QueryClient,
  ): UseMutationOptions<
    Awaited<ReturnType<typeof createDocument>>,
    Error,
    Parameters<typeof createDocument>[0]
  > => ({
    mutationFn: createDocument,
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  renameDocument: (
    queryClient: QueryClient,
  ): UseMutationOptions<boolean, Error, [string, string]> => ({
    mutationFn: ([id, title]) => renameDocument(id, title),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  duplicateDocument: (
    queryClient: QueryClient,
  ): UseMutationOptions<
    Awaited<ReturnType<typeof duplicateDocument>>,
    Error,
    [string, string?]
  > => ({
    mutationFn: ([id, title]) => duplicateDocument(id, title),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  softDeleteDocument: (queryClient: QueryClient): UseMutationOptions<boolean, Error, string> => ({
    mutationFn: softDeleteDocument,
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  restoreDocument: (queryClient: QueryClient): UseMutationOptions<boolean, Error, string> => ({
    mutationFn: restoreDocument,
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  createSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<Awaited<ReturnType<typeof createSeries>>, Error, [string, string[]?]> => ({
    mutationFn: ([title, lessonIds]) => createSeries(title, lessonIds),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  renameSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<boolean, Error, [string, string]> => ({
    mutationFn: ([id, title]) => renameSeries(id, title),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  duplicateSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<Awaited<ReturnType<typeof duplicateSeries>>, Error, [string, string?]> => ({
    mutationFn: ([id, title]) => duplicateSeries(id, title),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  addLessonsToSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<
    Awaited<ReturnType<typeof addLessonsToSeries>>,
    Error,
    [string, string[], number?]
  > => ({
    mutationFn: ([id, lessonIds, at]) => addLessonsToSeries(id, lessonIds, at),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  removeLessonFromSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<
    Awaited<ReturnType<typeof removeLessonFromSeries>>,
    Error,
    [string, string]
  > => ({
    mutationFn: ([id, lessonId]) => removeLessonFromSeries(id, lessonId),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  setSeriesLessons: (
    queryClient: QueryClient,
  ): UseMutationOptions<
    Awaited<ReturnType<typeof setSeriesLessons>>,
    Error,
    [string, string[]]
  > => ({
    mutationFn: ([id, lessonIds]) => setSeriesLessons(id, lessonIds),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  softDeleteSeries: (queryClient: QueryClient): UseMutationOptions<boolean, Error, string> => ({
    mutationFn: softDeleteSeries,
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  restoreSeries: (queryClient: QueryClient): UseMutationOptions<boolean, Error, string> => ({
    mutationFn: restoreSeries,
    onSuccess: () => invalidateLibrary(queryClient),
  }),
};

export function libraryCounts(
  documents: DocumentSummary[],
  series: SeriesWithLessons[],
): { lesson: number; worksheet: number; series: number } {
  return { ...librarySelectors.countsByKind(documents), series: series.length };
}

const collator = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" });

export function sortDocuments<
  T extends Pick<DocumentSummary, "title" | "updatedAt"> & { createdAt?: string },
>(documents: T[], sort: "edited" | "created" | "title"): T[] {
  const sorted = [...documents];
  if (sort === "title") sorted.sort((a, b) => collator.compare(a.title, b.title));
  else if (sort === "created") {
    sorted.sort((a, b) => (b.createdAt ?? b.updatedAt).localeCompare(a.createdAt ?? a.updatedAt));
  } else {
    sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return sorted;
}
