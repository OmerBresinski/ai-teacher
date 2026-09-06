import { sortDocuments } from "@/lib/library";
import type { DocumentSummary, SeriesWithLessons } from "@/mocks/library-schema";

export type LibraryMode = "home" | "lesson" | "worksheet" | "series";
export type Sort = "edited" | "created" | "title";
export type View = "grid" | "list";

export const SORTS: readonly Sort[] = ["edited", "created", "title"];
export const VIEWS: readonly View[] = ["grid", "list"];
export const SORT_LABELS: Record<Sort, string> = {
  edited: "Edited",
  created: "Created",
  title: "Title A–Z",
};
export const TITLES: Record<LibraryMode, string> = {
  home: "Home",
  lesson: "Lessons",
  worksheet: "Worksheets",
  series: "Series",
};

/** Home caps (TeachDeck `HOME_CARDS`, `HOME_BANDS`). */
export const HOME_CARDS = 4;
export const HOME_BANDS = 3;
/** Kind pages split into Recent / Earlier once the shelf is deep enough. */
export const SPLIT_AT = 8;
export const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

export const EMPTY_DOCUMENTS: DocumentSummary[] = [];
export const EMPTY_SERIES: SeriesWithLessons[] = [];

function matches(title: string, normalizedQuery: string): boolean {
  return normalizedQuery.length === 0 || title.toLowerCase().includes(normalizedQuery);
}

/** Documents a kind page shows: filtered by kind and title, sorted. */
export function kindShelf(
  documents: readonly DocumentSummary[],
  kind: "lesson" | "worksheet",
  query: string,
  sort: Sort,
): DocumentSummary[] {
  const normalized = query.trim().toLowerCase();
  const shelf: DocumentSummary[] = [];
  for (const document of documents) {
    if (document.kind === kind && matches(document.title, normalized)) shelf.push(document);
  }
  return sortDocuments(shelf, sort);
}

/** Series the index shows: filtered by title, sorted by the series record. */
export function seriesShelf(
  series: readonly SeriesWithLessons[],
  query: string,
  sort: Sort,
): SeriesWithLessons[] {
  const normalized = query.trim().toLowerCase();
  const matched = series.filter((item) => matches(item.series.title, normalized));
  const byId = new Map(matched.map((item) => [item.series.id, item]));
  const ordered: SeriesWithLessons[] = [];
  for (const entry of sortDocuments(
    matched.map((item) => item.series),
    sort,
  )) {
    const item = byId.get(entry.id);
    if (item) ordered.push(item);
  }
  return ordered;
}

/**
 * Recent / Earlier split for a kind page. `null` when the shelf is too shallow or one side would be
 * empty. `now` comes from the shared minute clock so a render never reads the wall clock.
 */
export function splitByRecency(
  shelf: readonly DocumentSummary[],
  now: number,
): { recent: DocumentSummary[]; earlier: DocumentSummary[] } | null {
  if (shelf.length <= SPLIT_AT) return null;
  const recent: DocumentSummary[] = [];
  const earlier: DocumentSummary[] = [];
  for (const document of shelf) {
    (now - Date.parse(document.updatedAt) < RECENT_MS ? recent : earlier).push(document);
  }
  return recent.length > 0 && earlier.length > 0 ? { recent, earlier } : null;
}

export type HomeShelves = {
  /** Newest lesson, shown two columns wide. */
  hero: DocumentSummary | undefined;
  /** The next documents beside the hero (two), or four when there is no lesson. */
  beside: DocumentSummary[];
  lessons: DocumentSummary[];
  worksheets: DocumentSummary[];
  lessonCount: number;
  worksheetCount: number;
};

/** Everything Home renders, derived in two passes over the documents. */
export function homeShelves(documents: readonly DocumentSummary[], sort: Sort): HomeShelves {
  const byEdited = sortDocuments([...documents], "edited");
  const hero = byEdited.find((document) => document.kind === "lesson");
  const beside = byEdited.filter((document) => document.id !== hero?.id).slice(0, hero ? 2 : 4);
  const lessons: DocumentSummary[] = [];
  const worksheets: DocumentSummary[] = [];
  for (const document of sortDocuments([...documents], sort)) {
    (document.kind === "lesson" ? lessons : worksheets).push(document);
  }
  return {
    hero,
    beside,
    lessons: lessons.slice(0, HOME_CARDS),
    worksheets: worksheets.slice(0, HOME_CARDS),
    lessonCount: lessons.length,
    worksheetCount: worksheets.length,
  };
}
