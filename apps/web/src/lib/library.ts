import {
  type InfiniteData,
  infiniteQueryOptions,
  keepPreviousData,
  notifyManager,
  type QueryClient,
  queryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import type {
  CreateLessonInput,
  DocumentKind,
  DocumentSummary,
  Lesson,
  Series,
  Worksheet,
} from "@tj/domain/documents";
import type { InferResponseType } from "hono/client";
import { api } from "./api";
import {
  cachedSummaryIndex,
  editDocumentSummaries,
  editSeries,
  type Rollback,
  withLessonIds,
} from "./library-optimistic";
import { ApiError, apiErrorFromResponse, queryKeys } from "./query";

/*
 * The library's data seam (ADR 0020, retired in favour of the documents API by ADR 0024 §9):
 * every screen reads through `libraryQueries` and writes through `libraryMutations`; nothing else
 * in `apps/web` calls `api.documents` or `api.lessons`. Lists are infinite queries over
 * `GET /documents?kind=&sort=&q=&cursor=` (§17); a document body is one entry the editor edits in
 * place (ADR 0022 §4) with its row state — `updatedAt` for optimistic concurrency, the generating
 * lock — beside it in `documentMeta`; every write is a whole-document `PUT` with
 * `expectedUpdatedAt` (§4) and a `409` is surfaced as `ApiError.reason` (§18). Ids are minted by
 * the server (§11): `create*` and `duplicate*` send a placeholder id and use the one they get back.
 */

/** The library's sort orders; `API_SORT` maps them onto the list endpoint's. */
export type Sort = "edited" | "created" | "title";
export const SORTS: readonly Sort[] = ["edited", "created", "title"];
const API_SORT = { edited: "updated", created: "created", title: "title" } as const;

/** One list page (ADR 0024 §17). The default page size, so 100 cards paint before a second fetch. */
export const PAGE_SIZE = 100;

type DocumentsPage = InferResponseType<typeof api.documents.$get, 200>;
/** The list-row shape the API serves: `DocumentSummary` plus the two row-state columns. */
export type LibrarySummary = DocumentsPage["items"][number];
type DocumentJson = InferResponseType<(typeof api.documents)[":id"]["$get"], 200>["document"];
type SeriesJson = InferResponseType<(typeof api.documents)[":id"]["lessons"]["$get"], 200>;

/** The document query resolves to the full editor document; its placeholder is the list summary. */
export type LibraryDocument = Lesson | Worksheet;
export type LibraryDocumentOrSummary = LibraryDocument | DocumentSummary;

/** The row state kept beside a document body (ADR 0024 §4, §18). */
export type DocumentMeta = {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  generatingJobId: string | null;
};

/** A series with its lessons' summaries in `lessonIds` order — the card and detail shape. */
export type SeriesWithLessons = { series: Series; lessons: DocumentSummary[] };

export function isFullDocument(value: LibraryDocumentOrSummary): value is LibraryDocument {
  return "version" in value;
}

/** `lesson` / `worksheet` for either shape — a summary carries `kind`, a body carries its content. */
export function kindOf(value: LibraryDocumentOrSummary): DocumentKind {
  if (!isFullDocument(value)) return value.kind;
  return "slides" in value ? "lesson" : "worksheet";
}

// --- transport --------------------------------------------------------------------------------

/** Row state from a document or list response. */
function metaOf(row: LibrarySummary): DocumentMeta {
  return {
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    generatingJobId: row.generatingJobId,
  };
}

/** The list-row view of a document response: everything but the body. */
function summaryOf(document: DocumentJson): LibrarySummary {
  const { body: _body, ...summary } = document;
  return summary;
}

/** `{ series, lessons }` from `GET /documents/:id/lessons`: the row's clock wins over the body's. */
function seriesOf(json: SeriesJson): SeriesWithLessons {
  const body = json.series.body as Series;
  return {
    series: { ...body, createdAt: json.series.createdAt, updatedAt: json.series.updatedAt },
    lessons: json.lessons,
  };
}

async function fetchPage(
  kind: DocumentKind,
  sort: Sort,
  q: string,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<DocumentsPage> {
  const res = await api.documents.$get(
    {
      query: {
        kind,
        sort: API_SORT[sort],
        q: q.trim() === "" ? undefined : q.trim(),
        cursor,
        limit: String(PAGE_SIZE),
      },
    },
    { init: { signal } },
  );
  if (res.status !== 200) throw await apiErrorFromResponse(res);
  return res.json();
}

/** `GET /documents/:id`; a missing id (or another Workspace's) is `null`, anything else throws. */
async function fetchDocument(id: string, signal?: AbortSignal): Promise<DocumentJson | null> {
  const res = await api.documents[":id"].$get({ param: { id } }, { init: { signal } });
  if (res.status === 200) return (await res.json()).document;
  if (res.status === 404) return null;
  throw await apiErrorFromResponse(res);
}

/** `fetchDocument` for a write path: a missing document is an error the caller reports. */
async function requireDocument(id: string): Promise<DocumentJson> {
  const document = await fetchDocument(id);
  if (document === null) {
    throw new ApiError(404, { code: "not_found", message: "That document does not exist." });
  }
  return document;
}

async function fetchSeries(id: string, signal?: AbortSignal): Promise<SeriesWithLessons | null> {
  const res = await api.documents[":id"].lessons.$get({ param: { id } }, { init: { signal } });
  if (res.status === 200) return seriesOf(await res.json());
  if (res.status === 404) return null;
  throw await apiErrorFromResponse(res);
}

async function postDocument(kind: DocumentKind, body: unknown): Promise<DocumentJson> {
  const res = await api.documents.$post({ json: { kind, body } });
  if (res.status !== 201) throw await apiErrorFromResponse(res);
  return (await res.json()).document;
}

/**
 * Whole-document save with optimistic concurrency (ADR 0024 §4, §18). On `409` the row state is
 * refetched — `stale` means the working copy is behind, `generating` that a job holds the lock —
 * and the `ApiError` (with `reason`) is rethrown for the caller's UI. On success the meta entry
 * takes the new `updatedAt`, so the next save sends the right token without a read.
 */
async function putDocument(
  queryClient: QueryClient,
  document: Lesson | Worksheet | Series,
  expectedUpdatedAt: string,
): Promise<DocumentJson> {
  const res = await api.documents[":id"].$put({
    param: { id: document.id },
    json: { document, expectedUpdatedAt },
  });
  if (res.status !== 200) {
    const error = await apiErrorFromResponse(res);
    if (error.status === 409) {
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: queryKeys.libraryDocumentMeta(document.id) }),
      ];
      if (error.reason === "stale") {
        invalidations.push(
          queryClient.invalidateQueries({ queryKey: queryKeys.libraryDocument(document.id) }),
        );
      }
      await Promise.all(invalidations);
    }
    throw error;
  }
  const saved = (await res.json()).document;
  queryClient.setQueryData(queryKeys.libraryDocumentMeta(document.id), metaOf(saved));
  return saved;
}

/** The `expectedUpdatedAt` for a save: the cached row state, or a read when nothing is cached. */
async function expectedUpdatedAtFor(queryClient: QueryClient, id: string): Promise<string> {
  const cached = queryClient.getQueryData<DocumentMeta>(queryKeys.libraryDocumentMeta(id));
  if (cached) return cached.updatedAt;
  return (await requireDocument(id)).updatedAt;
}

/** Read, modify, write: the series mutations and rename all take this shape. */
async function updateDocument<T extends Lesson | Worksheet | Series>(
  queryClient: QueryClient,
  id: string,
  change: (body: T) => T,
): Promise<DocumentJson> {
  const current = await requireDocument(id);
  return putDocument(queryClient, change(current.body as T), current.updatedAt);
}

/**
 * The document factories (`@tj/editor/starter`) load on the first create or copy so the library
 * chunk never carries them (ADR 0022 §8).
 */
const factories = () => import("@tj/editor/starter");

// --- cache helpers ------------------------------------------------------------------------------

/** Every summary the loaded list pages hold, across kinds, sorts and searches. */
function cachedSummaries(queryClient: QueryClient): LibrarySummary[] {
  const summaries: LibrarySummary[] = [];
  for (const [, data] of queryClient.getQueriesData<InfiniteData<DocumentsPage>>({
    queryKey: queryKeys.libraryDocuments,
  })) {
    for (const page of data?.pages ?? []) summaries.push(...page.items);
  }
  return summaries;
}

/** The cached list entry for an id — the seed for detail placeholders and the loaders' fast path. */
export const libraryCache = {
  document: (queryClient: QueryClient, id: string): DocumentSummary | undefined =>
    cachedSummaries(queryClient).find((document) => document.id === id),
  seriesDetail: (queryClient: QueryClient, id: string): SeriesWithLessons | undefined => {
    for (const [, data] of queryClient.getQueriesData<InfiniteData<SeriesPage>>({
      queryKey: queryKeys.librarySeries,
    })) {
      for (const page of data?.pages ?? []) {
        const found = page.items.find((item) => item.series.id === id);
        if (found) return found;
      }
    }
    return undefined;
  },
  /**
   * The finished document, in one step (TEACH-251): the generating view calls this at the job's
   * terminal event. Any debounced body refetch still in flight is cancelled, the row is read once,
   * and the body and its row state are written in a single notification batch, so the page sees
   * the released lock and the finished body in the same render. Two refetches side by side could
   * land the row state first and mount the editor on the last debounced copy; the fit migration
   * then stamped that copy and the body refetch replaced it with the stored `fitVersion: 0`
   * lesson — un-tidied, and never re-fitted because the one run had been spent.
   */
  handOverDocument: async (queryClient: QueryClient, id: string): Promise<void> => {
    await queryClient.cancelQueries({ queryKey: queryKeys.libraryDocument(id) });
    const document = await fetchDocument(id);
    if (document === null || document.deletedAt !== null || document.kind === "series") return;
    notifyManager.batch(() => {
      queryClient.setQueryData(queryKeys.libraryDocument(id), document.body as LibraryDocument);
      queryClient.setQueryData(queryKeys.libraryDocumentMeta(id), metaOf(document));
    });
  },
};

type SeriesPage = { items: SeriesWithLessons[]; nextCursor: string | null };

// --- queries ------------------------------------------------------------------------------------

export type ListOptions = { sort?: Sort; q?: string };

export const libraryQueries = {
  /**
   * One kind's list, paged by the server's keyset cursor (ADR 0024 §17). `sort` and `q` are part
   * of the key, so a new search or order is a new list; `keepPreviousData` keeps the old cards on
   * screen while it loads.
   */
  documents: (kind: DocumentKind, { sort = "edited", q = "" }: ListOptions = {}) =>
    infiniteQueryOptions({
      queryKey: [...queryKeys.libraryDocuments, kind, sort, q.trim()] as const,
      queryFn: ({ pageParam, signal }) => fetchPage(kind, sort, q, pageParam, signal),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      placeholderData: keepPreviousData,
    }),
  /**
   * The full editor document. Typed as the union because the placeholder seeded from the list
   * cache is a summary; narrow with `isFullDocument` before reading slides or blocks. A deleted
   * or missing document resolves to `null` (the page's "missing" state). The row state travels
   * with the body into `documentMeta`, so a save has its `expectedUpdatedAt` without a read.
   */
  document: (id: string, queryClient?: QueryClient) =>
    queryOptions<LibraryDocumentOrSummary | null>({
      queryKey: queryKeys.libraryDocument(id),
      queryFn: async ({ client, signal }): Promise<LibraryDocumentOrSummary | null> => {
        const document = await fetchDocument(id, signal);
        if (document === null || document.deletedAt !== null || document.kind === "series") {
          return null;
        }
        client.setQueryData(queryKeys.libraryDocumentMeta(id), metaOf(document));
        return document.body as LibraryDocument;
      },
      placeholderData: (): LibraryDocumentOrSummary | undefined =>
        queryClient ? libraryCache.document(queryClient, id) : undefined,
      // The editor edits this entry in place (ADR 0022 §4): a refetch under an in-flight save
      // would replace the teacher's edits with the stored copy. Saves refresh the lists only; a
      // `409 stale` invalidates this key explicitly so a Reload refetches it.
      staleTime: Number.POSITIVE_INFINITY,
    }),
  /**
   * The row state beside a document body: `updatedAt` (the save token) and `generatingJobId`
   * (ADR 0024 §18 — the editor is read-only while it is set). Filled by `document`'s fetch; its
   * own `queryFn` covers a page that mounts before the body has been read.
   */
  documentMeta: (id: string) =>
    queryOptions({
      queryKey: queryKeys.libraryDocumentMeta(id),
      queryFn: async ({ signal }): Promise<DocumentMeta | null> => {
        const document = await fetchDocument(id, signal);
        return document === null ? null : metaOf(document);
      },
      staleTime: Number.POSITIVE_INFINITY,
    }),
  /**
   * The series list with each series' lessons (ADR 0024 §12): a page of series summaries, then
   * `GET /documents/:id/lessons` for each, in parallel. The list endpoint carries no lesson ids,
   * so the cards' thumbnails need the second round; a series page is a few rows, never hundreds.
   */
  series: ({ sort = "edited", q = "" }: ListOptions = {}) =>
    infiniteQueryOptions({
      queryKey: [...queryKeys.librarySeries, sort, q.trim()] as const,
      queryFn: async ({ pageParam, signal }): Promise<SeriesPage> => {
        const page = await fetchPage("series", sort, q, pageParam, signal);
        const items = await Promise.all(
          page.items.map(async (row) => {
            const detail = await fetchSeries(row.id, signal);
            return (
              detail ?? {
                series: {
                  id: row.id,
                  title: row.title,
                  lessonIds: [],
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt,
                },
                lessons: [],
              }
            );
          }),
        );
        return { items, nextCursor: page.nextCursor };
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      placeholderData: keepPreviousData,
    }),
  seriesDetail: (id: string, queryClient?: QueryClient) =>
    queryOptions<SeriesWithLessons | null>({
      queryKey: queryKeys.librarySeriesDetail(id),
      queryFn: ({ signal }) => fetchSeries(id, signal),
      placeholderData: () => (queryClient ? libraryCache.seriesDetail(queryClient, id) : undefined),
    }),
};

export type LibraryDocumentsQuery = ReturnType<typeof libraryQueries.documents>;
export type LibrarySeriesQuery = ReturnType<typeof libraryQueries.series>;

/** `select` helpers: subscribe components to the slice they render, not the whole list. */
export const librarySelectors = {
  /** Every loaded row across pages, in server order. */
  items: <T>(data: InfiniteData<{ items: T[] }>): T[] =>
    data.pages.length === 1 ? (data.pages[0]?.items ?? []) : data.pages.flatMap((p) => p.items),
  /**
   * How many rows have loaded so far. The API returns no total (ADR 0024 §17), so this is the
   * count of loaded pages — exact until a list grows past one page.
   */
  count: (data: InfiniteData<{ items: unknown[] }>): number =>
    data.pages.reduce((sum, page) => sum + page.items.length, 0),
};

// --- mutations ----------------------------------------------------------------------------------

function invalidateLibrary(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.library });
}

/**
 * The optimistic half of a mutation (v5 `onMutate` / `onError` / `onSettled`): apply the edit to
 * the cache before the request, put the snapshot back if it fails, and reconcile with the server
 * either way. Spread into a mutation's options beside its `mutationFn`.
 */
function optimistic<TVariables>(
  queryClient: QueryClient,
  apply: (variables: TVariables) => Promise<Rollback>,
): Pick<
  UseMutationOptions<unknown, Error, TVariables, Rollback>,
  "onMutate" | "onError" | "onSettled"
> {
  return {
    onMutate: apply,
    onError: (_error, _variables, rollback) => rollback?.(),
    onSettled: () => invalidateLibrary(queryClient),
  };
}

/**
 * The optimistic rename of a document: its cards and series rows through the list snapshot, plus
 * — if a copy of the body is cached — its title there too, with its own restore, since the list
 * snapshot deliberately leaves document bodies alone.
 */
async function applyRename(queryClient: QueryClient, id: string, title: string): Promise<Rollback> {
  const rollbackLists = await editDocumentSummaries(queryClient, (row) =>
    row.id === id ? { ...row, title } : row,
  );
  const bodyKey = queryKeys.libraryDocument(id);
  const before = queryClient.getQueryData<LibraryDocumentOrSummary | null>(bodyKey);
  if (before) queryClient.setQueryData(bodyKey, { ...before, title });
  return () => {
    rollbackLists();
    if (before && queryClient.isMutating() <= 1) queryClient.setQueryData(bodyKey, before);
  };
}

/** Refresh the lists only — the document working copies stay as the editor left them. */
function invalidateLists(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.libraryDocuments }),
    queryClient.invalidateQueries({ queryKey: queryKeys.librarySeries }),
    queryClient.invalidateQueries({ queryKey: queryKeys.librarySeriesDetails }),
  ]).then(() => undefined);
}

export type CreateDocumentInput = {
  kind: "lesson" | "worksheet";
  title: string;
  themeId: string;
  subject?: string;
  yearGroup?: string;
  readingLevel?: string;
  language?: string;
  start?: string;
};

const now = () => new Date().toISOString();

/** The series list operations, pure over `lessonIds`. */
const seriesOps = {
  add(series: Series, lessonIds: string[], at?: number): Series {
    const existing = new Set(series.lessonIds);
    const additions = lessonIds.filter((id) => {
      if (existing.has(id)) return false;
      existing.add(id);
      return true;
    });
    if (additions.length === 0) return series;
    const index =
      at === undefined
        ? series.lessonIds.length
        : Math.max(0, Math.min(series.lessonIds.length, at));
    return {
      ...series,
      lessonIds: [
        ...series.lessonIds.slice(0, index),
        ...additions,
        ...series.lessonIds.slice(index),
      ],
    };
  },
  remove(series: Series, lessonId: string): Series {
    if (!series.lessonIds.includes(lessonId)) return series;
    return { ...series, lessonIds: series.lessonIds.filter((id) => id !== lessonId) };
  },
  /** A full reorder; ids the series does not hold are ignored. */
  set(series: Series, lessonIds: string[]): Series {
    const held = new Set(series.lessonIds);
    const next = lessonIds.filter((id) => held.has(id));
    const unchanged =
      next.length === series.lessonIds.length && next.every((id, i) => id === series.lessonIds[i]);
    return unchanged ? series : { ...series, lessonIds: next };
  },
};

/** A `PUT` that skips the network when `change` returns the same object. */
async function updateSeries(
  queryClient: QueryClient,
  id: string,
  change: (series: Series) => Series,
): Promise<Series> {
  const current = await requireDocument(id);
  const before = current.body as Series;
  const after = change(before);
  if (after === before) return before;
  const saved = await putDocument(queryClient, { ...after, updatedAt: now() }, current.updatedAt);
  return saved.body as Series;
}

/**
 * The optimistic half of a series membership write: the same pure `seriesOps` change applied to
 * the cached item, with its lesson rows re-derived from what the lists already hold.
 */
function applySeriesLessons(
  queryClient: QueryClient,
  id: string,
  change: (series: Series) => Series,
): Promise<Rollback> {
  const known = cachedSummaryIndex(queryClient);
  return editSeries(queryClient, (item) =>
    item.series.id === id ? withLessonIds(item, change(item.series).lessonIds, known) : item,
  );
}

export const libraryMutations = {
  createDocument: (
    queryClient: QueryClient,
  ): UseMutationOptions<LibrarySummary, Error, CreateDocumentInput> => ({
    mutationFn: async (input) => {
      const { newLesson, newWorksheet, starterLesson, starterWorksheet } = await factories();
      const title = input.title.trim();
      const starter = input.start !== "blank";
      const body: Lesson | Worksheet =
        input.kind === "lesson"
          ? starter
            ? starterLesson(title, input.themeId)
            : newLesson(title, input.themeId)
          : starter
            ? starterWorksheet(title, input.themeId)
            : newWorksheet(title, input.themeId);
      if (input.subject) body.subject = input.subject;
      if (input.yearGroup) body.yearGroup = input.yearGroup;
      if (input.readingLevel) body.readingLevel = input.readingLevel;
      if (input.language) body.language = input.language;
      return summaryOf(await postDocument(input.kind, body));
    },
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  /**
   * A worksheet the caller has already built (TEACH-184: the creation flow's recipe frame, or the
   * starter sheet for Blank), posted as it is. The whole frame is the document's initial state.
   */
  createWorksheet: (
    queryClient: QueryClient,
  ): UseMutationOptions<LibrarySummary, Error, Worksheet> => ({
    mutationFn: async (body) => summaryOf(await postDocument("worksheet", body)),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  /**
   * Import (ADR 0023 §6, amended 2026-09-12): a `Lesson` or `Worksheet` the import dialog has
   * already run through `migrate()` and the parser, posted whole to `POST /documents`. The server
   * mints the row id and writes it into `body.id` (`createDocument`), so importing the same file
   * twice yields two documents and the file's own `id` is never reused.
   */
  importDocument: (
    queryClient: QueryClient,
  ): UseMutationOptions<LibrarySummary, Error, Lesson | Worksheet> => ({
    mutationFn: async (body) =>
      summaryOf(await postDocument("blocks" in body ? "worksheet" : "lesson", body)),
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  /**
   * `POST /lessons` (ADR 0024 §6): the brief becomes a locked lesson and a queued `lesson.plan`
   * job; the caller navigates to `/l/$lessonId` and follows the job (TEACH-122).
   */
  createLesson: (
    queryClient: QueryClient,
  ): UseMutationOptions<{ lessonId: string; jobId: string }, Error, CreateLessonInput> => ({
    mutationFn: async (input) => {
      const res = await api.lessons.$post({ json: input });
      if (res.status !== 202) throw await apiErrorFromResponse(res);
      return res.json();
    },
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  saveDocument: (queryClient: QueryClient): UseMutationOptions<void, Error, LibraryDocument> => ({
    mutationFn: async (document) => {
      await putDocument(
        queryClient,
        document,
        await expectedUpdatedAtFor(queryClient, document.id),
      );
    },
    onSuccess: () => invalidateLists(queryClient),
  }),
  /**
   * The editor's autosave (ADR 0022 §5). The document's own cache entry is the editor's working
   * copy and is *not* refetched on success: a save that resolves after the next edit would put the
   * stored copy back over it. Only the lists — cards, counts, series rows — are refreshed, so the
   * library shows the new title and `updatedAt` when the teacher returns. A `409` rejects with
   * `ApiError.reason` (`stale` → the page offers Reload; `generating` → read-only), see `putDocument`.
   */
  autosaveDocument: (
    queryClient: QueryClient,
  ): UseMutationOptions<void, Error, LibraryDocument> => ({
    mutationFn: async (document) => {
      await putDocument(
        queryClient,
        document,
        await expectedUpdatedAtFor(queryClient, document.id),
      );
    },
    onSuccess: () => invalidateLists(queryClient),
  }),
  renameDocument: (
    queryClient: QueryClient,
  ): UseMutationOptions<boolean, Error, [string, string], Rollback> => ({
    mutationFn: async ([id, title]) => {
      const trimmed = title.trim();
      if (!trimmed) return false;
      await updateDocument<LibraryDocument>(queryClient, id, (body) => ({
        ...body,
        title: trimmed,
        updatedAt: now(),
      }));
      return true;
    },
    ...optimistic(queryClient, ([id, title]) => applyRename(queryClient, id, title.trim())),
  }),
  duplicateDocument: (
    queryClient: QueryClient,
  ): UseMutationOptions<LibrarySummary | null, Error, [string, string?]> => ({
    mutationFn: async ([id, title]) => {
      const source = await fetchDocument(id);
      if (source === null || source.deletedAt !== null || source.kind === "series") return null;
      const { cloneSlide } = await factories();
      const at = now();
      const body = structuredClone(source.body) as LibraryDocument;
      body.title = (title ?? `${body.title} (copy)`).trim();
      body.createdAt = at;
      body.updatedAt = at;
      // Fresh element ids too, so a copy can later sit beside its source in one document safely.
      if ("slides" in body) body.slides = body.slides.map(cloneSlide);
      return summaryOf(await postDocument(source.kind, body));
    },
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  softDeleteDocument: (
    queryClient: QueryClient,
  ): UseMutationOptions<boolean, Error, string, Rollback> => ({
    mutationFn: async (id) => {
      const res = await api.documents[":id"].$delete({ param: { id } });
      if (res.status !== 204) throw await apiErrorFromResponse(res);
      return true;
    },
    ...optimistic(queryClient, (id) =>
      editDocumentSummaries(queryClient, (row) => (row.id === id ? null : row)),
    ),
  }),
  restoreDocument: (queryClient: QueryClient): UseMutationOptions<boolean, Error, string> => ({
    mutationFn: async (id) => {
      const res = await api.documents[":id"].restore.$post({ param: { id } });
      if (res.status !== 200) throw await apiErrorFromResponse(res);
      return true;
    },
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  createSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<Series, Error, [string, string[]?]> => ({
    mutationFn: async ([title, lessonIds = []]) => {
      const at = now();
      const body: Series = {
        id: "new",
        title: title.trim(),
        lessonIds,
        createdAt: at,
        updatedAt: at,
      };
      return (await postDocument("series", body)).body as Series;
    },
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  renameSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<boolean, Error, [string, string], Rollback> => ({
    mutationFn: async ([id, title]) => {
      const trimmed = title.trim();
      if (!trimmed) return false;
      await updateSeries(queryClient, id, (series) => ({ ...series, title: trimmed }));
      return true;
    },
    ...optimistic(queryClient, ([id, title]) =>
      editSeries(queryClient, (item) =>
        item.series.id === id ? { ...item, series: { ...item.series, title: title.trim() } } : item,
      ),
    ),
  }),
  duplicateSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<Series | null, Error, [string, string?]> => ({
    mutationFn: async ([id, title]) => {
      const source = await fetchDocument(id);
      if (source === null || source.deletedAt !== null || source.kind !== "series") return null;
      const from = source.body as Series;
      const at = now();
      const body: Series = {
        id: "new",
        title: (title ?? `${from.title} (copy)`).trim(),
        lessonIds: [...from.lessonIds],
        createdAt: at,
        updatedAt: at,
      };
      return (await postDocument("series", body)).body as Series;
    },
    onSuccess: () => invalidateLibrary(queryClient),
  }),
  addLessonsToSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<Series, Error, [string, string[], number?], Rollback> => ({
    mutationFn: ([id, lessonIds, at]) =>
      updateSeries(queryClient, id, (series) => seriesOps.add(series, lessonIds, at)),
    ...optimistic(queryClient, ([id, lessonIds, at]) =>
      applySeriesLessons(queryClient, id, (series) => seriesOps.add(series, lessonIds, at)),
    ),
  }),
  removeLessonFromSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<Series, Error, [string, string], Rollback> => ({
    mutationFn: ([id, lessonId]) =>
      updateSeries(queryClient, id, (series) => seriesOps.remove(series, lessonId)),
    ...optimistic(queryClient, ([id, lessonId]) =>
      applySeriesLessons(queryClient, id, (series) => seriesOps.remove(series, lessonId)),
    ),
  }),
  setSeriesLessons: (
    queryClient: QueryClient,
  ): UseMutationOptions<Series, Error, [string, string[]], Rollback> => ({
    mutationFn: ([id, lessonIds]) =>
      updateSeries(queryClient, id, (series) => seriesOps.set(series, lessonIds)),
    ...optimistic(queryClient, ([id, lessonIds]) =>
      applySeriesLessons(queryClient, id, (series) => seriesOps.set(series, lessonIds)),
    ),
  }),
  softDeleteSeries: (
    queryClient: QueryClient,
  ): UseMutationOptions<boolean, Error, string, Rollback> => ({
    mutationFn: async (id) => {
      const res = await api.documents[":id"].$delete({ param: { id } });
      if (res.status !== 204) throw await apiErrorFromResponse(res);
      return true;
    },
    ...optimistic(queryClient, (id) =>
      editSeries(queryClient, (item) => (item.series.id === id ? null : item)),
    ),
  }),
  restoreSeries: (queryClient: QueryClient): UseMutationOptions<boolean, Error, string> => ({
    mutationFn: async (id) => {
      const res = await api.documents[":id"].restore.$post({ param: { id } });
      if (res.status !== 200) throw await apiErrorFromResponse(res);
      return true;
    },
    onSuccess: () => invalidateLibrary(queryClient),
  }),
};

const collator = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" });

/**
 * Client-side order for the Home shelves, which merge the first page of two kinds and pick the
 * hero by edit time whatever the sort preference. Kind pages take the server's order.
 */
export function sortDocuments<
  T extends Pick<DocumentSummary, "title" | "updatedAt"> & { createdAt?: string },
>(documents: T[], sort: Sort): T[] {
  const sorted = [...documents];
  if (sort === "title") sorted.sort((a, b) => collator.compare(a.title, b.title));
  else if (sort === "created") {
    sorted.sort((a, b) => (b.createdAt ?? b.updatedAt).localeCompare(a.createdAt ?? a.updatedAt));
  } else {
    sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return sorted;
}
