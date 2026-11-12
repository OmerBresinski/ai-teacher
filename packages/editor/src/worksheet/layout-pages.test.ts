import { describe, expect, test } from "bun:test";
import type { Worksheet } from "@tj/domain/documents";
import sheets from "./fixtures/v5-practice-sheets.json";
import { CONTENT_H } from "./metrics";
import { buildFlow, HEADER_KEY, heightsAt, layoutPages, paginate } from "./paginate";
import { sheetSizes } from "./sheet-sizes";

/*
 * R5 (12 Nov key check): the 15 saved v5 Practice sheets, with the heights the print route
 * measured for them in Chromium (scratchpad/pr-shots/ws-layout). Before: the Year 2 sheets ran to
 * 3, 3, 2, 3, 2 pages and the Year 5 rep5 sheet left its Challenge alone on page 3.
 */
type Fixture = { worksheet: Worksheet; heights: Record<string, number>; pagesBefore: number };
const all = sheets as unknown as Record<string, Fixture>;

function lay(f: Fixture) {
  const sizes = sheetSizes(f.worksheet);
  const items = buildFlow(f.worksheet, "pupil");
  const header = f.heights[HEADER_KEY] ?? 0;
  const layout = layoutPages(
    items,
    f.heights,
    header,
    CONTENT_H,
    { lineGapPt: sizes.lineGapPt, boxScale: sizes.boxScale },
    { lineGapPt: sizes.minLineGapPt, boxScale: sizes.minBoxScale },
  );
  return { items, header, layout, sizes };
}

describe("layoutPages on the saved v5 sheets", () => {
  test("the old pagination reproduces the before page counts", () => {
    for (const f of Object.values(all)) {
      const sizes = sheetSizes(f.worksheet);
      const items = buildFlow(f.worksheet, "pupil");
      const p = paginate(items, f.heights, f.heights[HEADER_KEY] ?? 0, CONTENT_H, sizes.lineGapPt);
      expect(p.pages.length).toBe(f.pagesBefore);
    }
  });

  test("every Year 2 sheet prints on 2 pages and every sheet on at most 2", () => {
    for (const [key, f] of Object.entries(all)) {
      const n = lay(f).layout.pages.length;
      if (key.includes("y2-")) expect([key, n]).toEqual([key, 2]);
      expect(n).toBeLessThanOrEqual(2);
    }
  });

  test("no page overflows and no question is parted from its space", () => {
    for (const f of Object.values(all)) {
      const { layout, header } = lay(f);
      expect(layout.oversize).toEqual([]);
      for (const page of layout.pages) {
        const used = page.items.reduce(
          (s, it) => s + (layout.heights[it.key] ?? 0),
          page.index === 0 ? header : 0,
        );
        expect(used).toBeLessThanOrEqual(CONTENT_H + 0.5);
        const last = page.items.at(-1);
        expect(last?.kind === "block" && last.block.type === "heading").toBe(false);
      }
    }
  });

  test("a sheet that already fits keeps its band's spacing", () => {
    const f = all["v5-r3-y2-greatfire"] as Fixture;
    const { layout, sizes } = lay(f);
    expect(layout.space).toEqual({ lineGapPt: sizes.lineGapPt, boxScale: sizes.boxScale });
  });

  test("a tightened sheet goes no tighter than the band floor, and only as far as it needs", () => {
    const f = all["v5-r1-y2-greatfire"] as Fixture;
    const { layout, sizes } = lay(f);
    expect(layout.space.lineGapPt).toBeLessThan(sizes.lineGapPt);
    expect(layout.space.lineGapPt).toBeGreaterThanOrEqual(sizes.minLineGapPt);
  });

  test("the Year 5 rep5 Challenge no longer stands alone on a page", () => {
    const { layout } = lay(all["v5-r5-y5-fractions"] as Fixture);
    const last = layout.pages.at(-1);
    const questions = last?.items.filter(
      (it) => it.kind === "block" && it.block.type === "question",
    );
    expect(questions?.length ?? 0).toBeGreaterThan(1);
  });
});

describe("heightsAt", () => {
  test("takes the line and box difference off each answer space only", () => {
    const f = all["v5-r1-y2-greatfire"] as Fixture;
    const items = buildFlow(f.worksheet, "pupil");
    const h = heightsAt(
      items,
      f.heights,
      { lineGapPt: 40, boxScale: 1.3 },
      { lineGapPt: 30, boxScale: 1 },
    );
    for (const it of items) {
      if (it.kind !== "block") continue;
      const lines = it.block.type === "question" ? it.block.answerLines : 0;
      expect(h[it.key]).toBeCloseTo((f.heights[it.key] ?? 0) - lines * 10, 5);
    }
  });
});
