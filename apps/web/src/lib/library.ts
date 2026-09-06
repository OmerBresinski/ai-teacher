import type { QueryClient, UseMutationOptions } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import type { Lesson, Worksheet } from "@tj/domain/documents";
import type { DocumentSummary, SeriesWithLessons } from "@/mocks/library-schema";

/**
 * The mock store carries the seed documents, `@tj/editor`'s factories and the document schemas.
 * It is loaded on the first query so the router's initial chunk stays free of it (ADR 0022 §8);
 * the real API client replaces this one line.
 */
const store = () => import("@/mocks/library-store");
type Store = Awaited<ReturnType<typeof store>>;
/** Call one store function once the module is loaded. */
const via =
  <K extends keyof Store>(name: K) =>
  (...args: Parameters<Store[K]>): ReturnType<Store[K]> =>
    store().then((m) => (m[name] as (...a: unknown[]) => unknown)(...args)) as ReturnType<Store[K]>;

import { queryKeys } from "./query";

/**
 * Query options for the library (ADR 0020). Lists are the source of truth; the per-entity options
 * exist so route loaders, hover preloads and detail pages ask for exactly one record — the shape
 * the real API will serve. Until then `placeholderData` seeds a detail from the cached list so a
 * card → detail navigation paints immediately and the detail fetch settles behind it.
 */
/** The cached list entry for an id — the seed for detail placeholders and the loaders' fast path. */
export const libraryCache = {
  document: (queryClient: QueryClient, id: string): DocumentSummary | undefined =>
    queryClient
      .getQueryData<DocumentSummary[]>(queryKeys.libraryDocuments)
      ?.find((document) => document.id === id),
  seriesDetail: (queryClient: QueryClient, id: string): SeriesWithLessons | undefined =>
    queryClient
      .getQueryData<SeriesWithLessons[]>(queryKeys.librarySeries)
      ?.find((item) => item.series.id === id),
};

/** The document query resolves to the full editor document; its placeholder is the list summary. */
export type LibraryDocument = Lesson | Worksheet;
export type LibraryDocumentOrSummary = LibraryDocument | DocumentSummary;

export function isFullDocument(value: LibraryDocumentOrSummary): value is LibraryDocument {
  return "version" in value;
}

/** `lesson` / `worksheet` for either shape — a summary carries `kind`, a body carries its content. */
export function kindOf(value: LibraryDocumentOrSummary): DocumentSummary["kind"] {
  if (!isFullDocument(value)) return value.kind;
  return "slides" in value ? "lesson" : "worksheet";
}

export const libraryQueries = {
  documents: () =>
    queryOptions({ queryKey: queryKeys.libraryDocuments, queryFn: via("listDocuments") }),
  /**
   * The full editor document. Typed as the union because the placeholder seeded from the list
   * cache is a summary; narrow with `isFullDocument` before reading slides or blocks.
   */
  document: (id: string, queryClient?: QueryClient) =>
    queryOptions({
      queryKey: queryKeys.libraryDocument(id),
      queryFn: (): Promise<LibraryDocumentOrSummary | null> => via("loadDocument")(id),
      placeholderData: (): LibraryDocumentOrSummary | undefined =>
        queryClient ? libraryCache.document(queryClient, id) : undefined,
      // The editor edits this entry in place (ADR 0022 §4): a refetch under an in-flight save
      // would replace the teacher's edits with the store's last copy. The mock never changes
      // underneath; the API's saves invalidate `["library"]` on success, which covers this key.
      staleTime: Number.POSITIVE_INFINITY,
    }),
  series: () =>
    queryOptions({ queryKey: queryKeys.librarySeries, queryFn: via("listSeriesWithLessons") }),
  seriesDetail: (id: string, queryClient?: QueryClient) =>
    queryOptions({
      queryKey: queryKeys.librarySeriesDetail(id),
      queryFn: () => via("loadSeriesWithLessons")(id),
      placeholderData: () => (queryClient ? libraryCache.seriesDetail(queryClient, id) : undefined),
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
    Awaited<ReturnType<Store["createDocument"]>>,
    Error,
    Parameters<Store["createDocument"]>[0]
  > => ({
    mutationFn: via("createDocument"),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  saveDocument: (queryClient: QueryClient): UseMutationOptions<void, Error, LibraryDocument> => ({
    mutationFn: via("saveDocument"),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  /**
   * The editor's autosave (ADR 0022 §5). The document's own cache entry is the editor's working
   * copy and is *not* refetched on success: a save that resolves after the next edit would put the
   * stored copy back over it. Only the lists — cards, counts, series rows — are refreshed, so the
   * library shows the new title and `updatedAt` when the teacher returns.
   */
  autosaveDocument: (
    queryClient: QueryClient,
  ): UseMutationOptions<void, Error, LibraryDocument> => ({
    mutationFn: via("saveDocument"),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.libraryDocuments, exact: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.librarySeries }),
      ]).then(() => undefined),
  }),
  renameDocument: (
    queryClient: QueryClient,
  ): UseMutationOptions<boolean, Error, [string, string]> => ({
    mutationFn: ([id, title]) => via("renameDocument")(id, title),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  duplicateDocument: (
    queryClient: QueryClient,
  ): UseMutationOptions<
    Awaited<ReturnType<Store["duplicateDocument"]>>,
    Error,
    [string, string?]
  > => ({
    mutationFn: ([id, title]) => via("duplicateDocument")(id, title),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  softDeleteDocument: (queryClient: QueryClient): UseMutationOptions<boolean, Error, string> => ({
    mutationFn: via("softDeleteDocument"),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  restoreDocument: (queryClient: QueryClient): UseMutationOptions<boolean, Error, string> => ({
    mutationFn: via("restoreDocument"),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  createSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<
    Awaited<ReturnType<Store["createSeries"]>>,
    Error,
    [string, string[]?]
  > => ({
    mutationFn: ([title, lessonIds]) => via("createSeries")(title, lessonIds),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  renameSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<boolean, Error, [string, string]> => ({
    mutationFn: ([id, title]) => via("renameSeries")(id, title),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  duplicateSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<
    Awaited<ReturnType<Store["duplicateSeries"]>>,
    Error,
    [string, string?]
  > => ({
    mutationFn: ([id, title]) => via("duplicateSeries")(id, title),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  addLessonsToSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<
    Awaited<ReturnType<Store["addLessonsToSeries"]>>,
    Error,
    [string, string[], number?]
  > => ({
    mutationFn: ([id, lessonIds, at]) => via("addLessonsToSeries")(id, lessonIds, at),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  removeLessonFromSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<
    Awaited<ReturnType<Store["removeLessonFromSeries"]>>,
    Error,
    [string, string]
  > => ({
    mutationFn: ([id, lessonId]) => via("removeLessonFromSeries")(id, lessonId),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  setSeriesLessons: (
    queryClient: QueryClient,
  ): UseMutationOptions<
    Awaited<ReturnType<Store["setSeriesLessons"]>>,
    Error,
    [string, string[]]
  > => ({
    mutationFn: ([id, lessonIds]) => via("setSeriesLessons")(id, lessonIds),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  softDeleteSeries: (queryClient: QueryClient): UseMutationOptions<boolean, Error, string> => ({
    mutationFn: via("softDeleteSeries"),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  restoreSeries: (queryClient: QueryClient): UseMutationOptions<boolean, Error, string> => ({
    mutationFn: via("restoreSeries"),
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
