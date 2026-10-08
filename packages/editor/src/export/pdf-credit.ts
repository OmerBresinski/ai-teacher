/**
 * How a printed slide (the PDF) honours the pictures whose licence requires a credit: CC BY and
 * BY-SA Commons photos (TEACH-251). One switch, two answers:
 * - "line": the slide prints as it is, with a tiny grey credit line on it;
 * - "omit": those photos are left out of the printed slide and nothing is written.
 * The PDF ends on no credits page either way. Pure, so the print route and its tests share it.
 */
import type { Slide, SlideElement } from "@tj/domain/documents";
import { licenceCredits, requiresCredit } from "./credits";

export type PdfAttribution = "line" | "omit";

/** The one switch (pending Greg's call, TEACH-251). */
export const PDF_ATTRIBUTION: PdfAttribution = "line";

export type PrintedSlide = { slide: Slide; credits: string[] };

const withoutOwed = (elements: readonly SlideElement[]): SlideElement[] =>
  elements.flatMap((el): SlideElement[] => {
    if (el.type === "image" && requiresCredit(el.source)) return [];
    if (el.type === "group") return [{ ...el, children: withoutOwed(el.children) }];
    return [el];
  });

/** The slide to print and the credit lines to write on it. */
export function printedSlide(slide: Slide, mode: PdfAttribution = PDF_ATTRIBUTION): PrintedSlide {
  if (mode === "omit") {
    const owed = licenceCredits(slide).length > 0;
    return {
      slide: owed ? { ...slide, elements: withoutOwed(slide.elements) } : slide,
      credits: [],
    };
  }
  return { slide, credits: licenceCredits(slide) };
}
