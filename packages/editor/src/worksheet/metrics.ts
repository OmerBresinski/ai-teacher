import { PAGE_A4, PAGE_LETTER, type PageSize } from "@tj/domain/documents";

/**
 * Worksheet page geometry, in typographic points (TeachDeck `lib/worksheet/metrics.ts`).
 *
 * Everything on the sheet is expressed in `pt` in CSS as well, so the print route maps 1:1 onto
 * the paper and the editor is the same DOM under a single `transform: scale()`.
 *
 * Two papers ship: A4 and US Letter (research/02 decision 14). Only the page box changes — the
 * 18mm padding, the footer strip and the 9mm rule spacing are the same on both — so everything a
 * page size touches comes out of `pageMetrics()` and nothing else has to fork.
 */

/** Points per millimetre. */
export const MM = 72 / 25.4;

/** 18mm content padding (SPEC §9 / §10). */
export const PAGE_PAD = Math.round(18 * MM * 100) / 100; // 51.02pt

/** Strip at the foot of every page carrying "Page n of m" and the title. */
export const FOOTER_H = 26;

/** Ruled answer lines sit 9mm apart, as on an exam paper. */
export const LINE_GAP = Math.round(9 * MM * 100) / 100; // 25.51pt

/** Vertical rhythm between blocks; baked into every measured block height. */
export const BLOCK_GAP = 12;

export type PageMetrics = {
  size: PageSize;
  /** Page box in points. */
  page: { w: number; h: number };
  /** Width of the text column. */
  contentW: number;
  /** Height a page can hold. */
  contentH: number;
  /** The same page in real-world units, for the print media query. */
  printW: string;
  printH: string;
};

const PAPERS: Record<PageSize, { page: { w: number; h: number }; printW: string; printH: string }> =
  {
    A4: { page: PAGE_A4, printW: "210mm", printH: "297mm" },
    Letter: { page: PAGE_LETTER, printW: "8.5in", printH: "11in" },
  };

/**
 * Every metric that depends on the paper.
 *
 * `contentH` keeps two points of slack against the real page height (A4 is 841.89pt, not 842) so
 * a full page never spills into a blank second sheet.
 */
export function pageMetrics(size: PageSize = "A4"): PageMetrics {
  const name: PageSize = size === "Letter" ? "Letter" : "A4";
  const paper = PAPERS[name];
  return {
    size: name,
    page: paper.page,
    contentW: paper.page.w - PAGE_PAD * 2,
    contentH: paper.page.h - PAGE_PAD * 2 - FOOTER_H - 2,
    printW: paper.printW,
    printH: paper.printH,
  };
}

/** A4, the default paper. Kept as constants for the code that never varies. */
export const A4 = pageMetrics("A4");

/** Nominal page box (595x842pt). Print uses 210x297mm, 0.1mm larger in height. */
export const PAGE = A4.page;

/** Width of the A4 text column. */
export const CONTENT_W = A4.contentW; // 492.96pt

/** Height an A4 page can hold. */
export const CONTENT_H = A4.contentH; // 711.96pt

/**
 * Left gutter positions for the editor's drag handle and insert button, in pt from the text
 * column's left edge (research/06 §1: handle inboard at -28, the insert button outboard at -52,
 * both inside the 18mm page padding).
 */
export const HANDLE_X = -28;
export const PLUS_X = -52;

/** CSS px per pt. Browsers define 1pt as exactly 4/3px. */
export const PX_PER_PT = 4 / 3;

export const pxToPt = (px: number) => px / PX_PER_PT;
export const ptToPx = (pt: number) => pt * PX_PER_PT;

/** Editor zoom: the page is 793.7px wide at 1:1, so this fits it to `width`. */
export function fitScale(width: number, pageW: number = PAGE.w): number {
  return Math.min(1.1, Math.max(0.35, width / ptToPx(pageW)));
}
