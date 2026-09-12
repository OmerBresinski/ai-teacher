/**
 * PDF export (TeachDeck `lib/export/pdf.ts`; ADR 0023 §2). There is no PDF library: the print
 * route lays the deck out at exactly 960x540pt and the browser's own "Save as PDF" turns it into a
 * vector file with real text. This module builds the hrefs only — the app opens the tab through
 * `ExportControl`'s `onOpenPrint`, so `@tj/editor` never touches `window.open` or knows an origin.
 */

import { slideRangeParam } from "./range";

/** One slide per page, or three to an A4 page with note lines beside each. */
export type PrintLayout = "slides" | "handout3";

export type PrintViewOptions = {
  /** Question slides render with the answer showing. */
  answers?: boolean;
  /** A4 handout: the slide at 56% with the presenter notes beneath it. */
  notes?: boolean;
  /** Which slides to print, as the teacher typed it: "All", or "1-3, 5". */
  slides?: string;
  /** Page layout. Default one slide per page. */
  layout?: PrintLayout;
  /** Open the browser print dialog once the page is ready. Default true. */
  auto?: boolean;
};

/**
 * `/l/<id>/print?auto=1&answers=1&notes=1&handout=3&slides=1-3%2C5` — exactly the params the print
 * route's search schema reads; each is written only when it is on.
 */
export function printViewHref(lessonId: string, options: PrintViewOptions = {}): string {
  const params = new URLSearchParams();
  if (options.auto !== false) params.set("auto", "1");
  if (options.answers) params.set("answers", "1");
  if (options.notes) params.set("notes", "1");
  if (options.layout === "handout3") params.set("handout", "3");
  const range = slideRangeParam(options.slides ?? "");
  if (range) params.set("slides", range);
  const query = params.toString();
  return `/l/${encodeURIComponent(lessonId)}/print${query ? `?${query}` : ""}`;
}

/**
 * The worksheet's print route, which is also its PDF: the sheet is laid out at exact A4 or Letter
 * and the browser's own "Save as PDF" writes the file. The page size and the answer key come off the
 * saved worksheet, so this URL says nothing about them and cannot disagree with the sheet on screen.
 */
export function worksheetPrintHref(worksheetId: string, options: { auto?: boolean } = {}): string {
  const query = options.auto === false ? "" : "?auto=1";
  return `/w/${encodeURIComponent(worksheetId)}/print${query}`;
}
