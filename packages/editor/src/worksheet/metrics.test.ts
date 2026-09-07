import { describe, expect, test } from "bun:test";
import { PAGE_A4, PAGE_LETTER } from "@tj/domain/documents";
import { CONTENT_H, CONTENT_W, fitScale, pageMetrics, ptToPx, pxToPt } from "./metrics";

describe("pageMetrics", () => {
  test("is A4 by default; contentW/contentH are the page less 18mm padding, footer and 2pt slack", () => {
    expect(pageMetrics().page).toEqual(PAGE_A4);
    expect(pageMetrics("A4").contentW).toBeCloseTo(CONTENT_W, 2);
    expect(pageMetrics("A4").contentH).toBeCloseTo(CONTENT_H, 2);
    expect(CONTENT_W).toBeCloseTo(595 - 51.02 * 2, 2);
    expect(CONTENT_H).toBeCloseTo(842 - 51.02 * 2 - 26 - 2, 2);
    expect(pageMetrics("A4").printW).toBe("210mm");
    expect(pageMetrics("A4").printH).toBe("297mm");
  });

  test("gives Letter its own page box, text column and page height", () => {
    const letter = pageMetrics("Letter");
    expect(letter.page).toEqual(PAGE_LETTER);
    expect(letter.contentW).toBeCloseTo(612 - 51.02 * 2, 2);
    expect(letter.contentH).toBeCloseTo(792 - 51.02 * 2 - 26 - 2, 2);
    expect(letter.printW).toBe("8.5in");
    expect(letter.printH).toBe("11in");
    // Wider and shorter than A4: that is what reflows a sheet.
    expect(letter.contentW).toBeGreaterThan(pageMetrics("A4").contentW);
    expect(letter.contentH).toBeLessThan(pageMetrics("A4").contentH);
  });

  test("pt ↔ px at 4/3, and the zoom fits whichever page it is given", () => {
    expect(ptToPx(3)).toBe(4);
    expect(pxToPt(4)).toBe(3);
    const width = ptToPx(595) / 2;
    expect(fitScale(width, 595)).toBeCloseTo(0.5, 5);
    expect(fitScale(width, 612)).toBeLessThan(fitScale(width, 595));
    expect(fitScale(10)).toBe(0.35);
    expect(fitScale(100_000)).toBe(1.1);
  });
});
