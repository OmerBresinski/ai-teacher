import { describe, expect, test } from "bun:test";
import { PAGE_A4, PAGE_LETTER, type WorksheetBlock } from "@tj/domain/documents";
import { docFromText } from "../model/factories";
import { newBlock } from "../model/worksheet-factories";
import {
  CONTENT_H,
  CONTENT_W,
  estimateMinutes,
  fitScale,
  marksTotal,
  pageMetrics,
  ptToPx,
  pxToPt,
  sheetSummary,
} from "./metrics";

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

describe("estimateMinutes", () => {
  const q = (marks: number): WorksheetBlock => ({
    id: `q${marks}${Math.random()}`,
    type: "question",
    doc: docFromText("Why?"),
    answerLines: 2,
    marks,
  });

  test("an empty sheet is five minutes and no marks", () => {
    expect(estimateMinutes([])).toBe(5);
    expect(marksTotal([])).toBe(0);
    expect(sheetSummary([])).toBe("0 marks · about 5 min");
  });

  test("acceptance 3: twelve marks and a word search read as 25 minutes", () => {
    const blocks = [q(4), q(4), q(4), newBlock("word-search")];
    expect(marksTotal(blocks)).toBe(12);
    // 12 × 1.5 + 8 = 26, to the nearest five.
    expect(estimateMinutes(blocks)).toBe(25);
    expect(sheetSummary(blocks)).toBe("12 marks · about 25 min");
  });

  test("matching, gaps, multiple choice and paragraphs each add their share", () => {
    expect(estimateMinutes([newBlock("matching")])).toBe(5);
    expect(estimateMinutes([newBlock("matching"), q(2)])).toBe(5); // 4 + 3 = 7
    expect(estimateMinutes([newBlock("matching"), q(2), q(1)])).toBe(10); // 8.5
    const gaps = newBlock("fill-gap"); // two gaps
    const mc = newBlock("multiple-choice");
    expect(estimateMinutes([gaps, mc, q(4)])).toBe(10); // 2 + 1 + 6 = 9
    const words = Array.from({ length: 160 }, () => "word").join(" ");
    const para: WorksheetBlock = { id: "p", type: "paragraph", doc: docFromText(words) };
    expect(estimateMinutes([para, q(6)])).toBe(10); // 2 + 9 = 11 → 10
    expect(estimateMinutes([para, q(8)])).toBe(15); // 2 + 12 = 14 → 15
    expect(sheetSummary([q(1)])).toBe("1 mark · about 5 min");
  });
});
