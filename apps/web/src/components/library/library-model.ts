import type { DocumentSummary } from "@tj/domain/documents";
import { type SeriesWithLessons, SORTS, type Sort, sortDocuments } from "@/lib/library";

export type LibraryMode = "home" | "lesson" | "worksheet" | "series";
export type { Sort };
export type View = "grid" | "list";

export { SORTS };
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
/** The search box waits this long after the last keystroke before the list asks the server. */
export const SEARCH_DEBOUNCE_MS = 250;

export const EMPTY_DOCUMENTS: DocumentSummary[] = [];
export const EMPTY_SERIES: SeriesWithLessons[] = [];

/**
 * Recent / Earlier split for a kind page. `null` when the shelf is too shallow or one side would be
 * empty. `now` comes from the shared minute clock so a render never reads the wall clock. Each group
 * keeps the server's order, whatever the sort.
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

/**
 * Everything Home renders, derived from the first page of lessons and of worksheets. The hero and
 * the Recent strip always follow edit time; the two shelves follow the sort preference, which the
 * server already applied to each list.
 */
export function homeShelves(
  lessons: readonly DocumentSummary[],
  worksheets: readonly DocumentSummary[],
): HomeShelves {
  const byEdited = sortDocuments([...lessons, ...worksheets], "edited");
  const hero = byEdited.find((document) => document.kind === "lesson");
  const beside = byEdited.filter((document) => document.id !== hero?.id).slice(0, hero ? 2 : 4);
  return {
    hero,
    beside,
    lessons: lessons.slice(0, HOME_CARDS),
    worksheets: worksheets.slice(0, HOME_CARDS),
    lessonCount: lessons.length,
    worksheetCount: worksheets.length,
  };
}
