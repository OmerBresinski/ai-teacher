import { deriveAgeBand, type Worksheet } from "@tj/domain/documents";
import { FONT_STACKS } from "@tj/slides/fonts";
import { LINE_GAP, MM } from "./metrics";

/*
 * One table of sheet sizes by year band (WS8 round 2, from the 11 Nov teacher review: "KS1 font
 * size and handwriting space"). Print and the editor's page view read it through `sheetVars()`
 * (CSS variables the measuring column shares, so pagination measures what prints); Word reads it
 * in `export/docx.ts`. Every type size on the sheet is its secondary size times `type`; ruled
 * answer lines sit `lineGapPt` apart; answer and drawing boxes are their stored height times
 * `boxScale`. Page furniture (the footer) keeps its size.
 *
 * - Reception to Year 2: question text about 16.5pt and 15mm handwriting lines, the size of a
 *   primary exercise book, with boxes 1.6 times taller for drawing and big writing.
 * - Years 3 to 6: a step between, about 13pt and 11mm lines.
 * - Year 7 up (and a sheet with no year): the secondary sheet as it was, 11pt and 9mm lines.
 */

export type SheetBand = "ks1" | "ks2" | "secondary";

export type SheetSizes = {
  /** Multiplier on every type size of the sheet (11pt body at 1). */
  type: number;
  /** Distance between ruled answer lines, in pt. */
  lineGapPt: number;
  /** Multiplier on an answer box's stored `heightPt`. */
  boxScale: number;
  /**
   * The band's own typeface for the whole sheet, else the theme's. R3: Reception to Year 2 use the
   * young-children theme's rounded face (Playpen Sans, the crayon theme's body), shipped with the
   * editor (`fonts-playful.css`) and so embedded in print.
   */
  font?: string;
};

export const SHEET_SIZES: Record<SheetBand, SheetSizes> = {
  // R3: boxes start smaller (ks1 1.6 -> 1.3, ks2 1.25 -> 1) because print now grows every box into
  // its page's spare room (`fillPages`, up to twice): the base size decides the page count, the
  // fill gives the room back. Ruled lines keep the band's handwriting height.
  ks1: {
    type: 1.5,
    lineGapPt: Math.round(15 * MM * 100) / 100,
    boxScale: 1.3,
    font: FONT_STACKS.playpen,
  },
  ks2: { type: 1.18, lineGapPt: Math.round(11 * MM * 100) / 100, boxScale: 1 },
  secondary: { type: 1, lineGapPt: LINE_GAP, boxScale: 1 },
};

/** The sheet's band, from its year group, else its stored age band; secondary when neither says. */
export function sheetBand(worksheet: Pick<Worksheet, "yearGroup" | "ageBand">): SheetBand {
  const band = deriveAgeBand(worksheet.yearGroup) ?? worksheet.ageBand;
  if (band === "eyfs" || band === "ks1") return "ks1";
  if (band === "ks2") return "ks2";
  return "secondary";
}

export const sheetSizes = (worksheet: Pick<Worksheet, "yearGroup" | "ageBand">): SheetSizes =>
  SHEET_SIZES[sheetBand(worksheet)];
