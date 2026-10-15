import { describe, expect, test } from "bun:test";
import { HIGHLIGHT_SLOTS, type RichDoc, styledRun } from "@tj/domain/documents";
import fixtures from "./fixtures/line-of-offset.json";
import { lineBreaks, lineOfOffset, runRects, runStyleOf } from "./text-lines";
import { charAdvance, countLines, measureHeadless, quoteFaceOf } from "./text-measure";
import { v2Profile } from "./theme-v2";
import { getTheme, THEMES } from "./themes";

/* TEACH-205 part c (S-d2): line lookup and run rects on the headless ruler. */

const paper = getTheme("paper");
const TEXT =
  "The Romans built roads that ran straight for miles, so their armies could march quickly between towns.";

describe("lineBreaks and lineOfOffset", () => {
  test("break count equals countLines across themes, presets and widths", () => {
    for (const id of ["paper", "studio", "exam-hall", "playground", "night-lab"]) {
      const theme = getTheme(id);
      for (const preset of ["body", "heading", "small", "title"] as const)
        for (let w = 120; w <= 900; w += 37) {
          expect(lineBreaks(TEXT, preset, theme, w).length).toBe(
            countLines(TEXT, preset, theme, w),
          );
        }
    }
  });

  test("each line's first offset is on that line, and lines never go backwards", () => {
    const starts = lineBreaks(TEXT, "body", paper, 300);
    expect(starts[0]).toBe(0);
    starts.forEach((s, k) => {
      expect(lineOfOffset(TEXT, s, "body", paper, 300)).toBe(k);
    });
    let last = 0;
    for (let i = 0; i < TEXT.length; i++) {
      const line = lineOfOffset(TEXT, i, "body", paper, 300);
      expect(line).toBeGreaterThanOrEqual(last);
      last = line;
    }
    expect(lineOfOffset(TEXT, TEXT.length + 5, "body", paper, 300)).toBe(starts.length - 1);
  });

  test("a hard break starts a line; a word wider than the column breaks inside itself", () => {
    expect(lineBreaks("one\ntwo", "body", paper, 600)).toEqual([0, 4]);
    expect(lineOfOffset("one\ntwo", 5, "body", paper, 600)).toBe(1);
    const long = "Pneumonoultramicroscopicsilicovolcanoconiosis";
    const n = countLines(long, "heading", paper, 200);
    expect(n).toBeGreaterThan(1);
    expect(lineOfOffset(long, long.length - 1, "heading", paper, 200)).toBe(n - 1);
  });

  test("the quote face measures in its own advances", () => {
    // Paper quotes in its serif: the same words in it take a different width than in the body face.
    const differ = [160, 200, 240, 280, 320, 360, 400].filter(
      (w) =>
        lineBreaks(TEXT, "body", paper, w).join() !==
        lineBreaks(TEXT, "body", paper, w, { font: "quote" }).join(),
    );
    expect(differ.length).toBeGreaterThan(0);
    // A v1 theme quotes in its body face: nothing moves.
    const studio = getTheme("studio");
    expect(lineBreaks(TEXT, "body", studio, 240, { font: "quote" })).toEqual(
      lineBreaks(TEXT, "body", studio, 240),
    );
  });

  test("the ruler's quote face is v2Profile's on every theme and stage", () => {
    for (const t of THEMES)
      for (const band of ["eyfs", "ks1", "ks2", "ks3", "ks5"]) {
        const theme = getTheme(t.id, band);
        expect(quoteFaceOf(theme)).toEqual({
          family: v2Profile(theme).fonts.quote,
          italic: v2Profile(theme).quoteStyle === "italic",
        });
      }
  });

  test("non-ASCII counts 1em until A7 gives it real metrics (the RTL hook)", () => {
    expect(charAdvance("ب".codePointAt(0) ?? 0, undefined)).toBe(1);
    expect(charAdvance(65, undefined)).toBe(1);
  });
});

describe("lineOfOffset matches the rendered line (20 Chromium fixtures, row 4)", () => {
  // fx-1 is the ruler's known error mode (it ignores kerning, so it errs a word early at a wrap):
  // Chromium fits "it" on line 3 of 4; the ruler moves it down. Every other fixture is exact.
  const KNOWN = new Set(["fx-1"]);
  for (const c of fixtures.cases) {
    test(`${c.id} ${c.theme} ${c.preset} at ${c.w}pt`, () => {
      const theme = getTheme(c.theme);
      const got = lineOfOffset(c.text, c.offset, c.preset as "body", theme, c.w);
      const want = c.drawn[c.offset];
      if (KNOWN.has(c.id)) expect(Math.abs(got - (want ?? 0))).toBeLessThanOrEqual(1);
      else expect(got).toBe(want as number);
      expect(lineBreaks(c.text, c.preset as "body", theme, c.w).length).toBe(c.drawnLines);
    });
  }
  test("every character of the 20 fixtures: at most 2 off by a line", () => {
    let off = 0;
    for (const c of fixtures.cases) {
      const theme = getTheme(c.theme);
      for (let i = 0; i < c.text.length; i++)
        if (
          c.text[i] !== " " &&
          lineOfOffset(c.text, i, c.preset as "body", theme, c.w) !== c.drawn[i]
        )
          off += 1;
    }
    expect(off).toBeLessThanOrEqual(2);
  });
});

describe("runRects", () => {
  const doc = (...runs: ReturnType<typeof styledRun>[]): RichDoc => ({
    type: "doc",
    content: [{ type: "paragraph", content: runs }],
  });

  test("a highlight across a line break is one rect per line, on consecutive lines", () => {
    const d = doc(
      styledRun("Rivers erode their banks ", {}),
      styledRun("fastest on the outside of a bend, where the water flows quickest", {
        highlight: 2,
      }),
      styledRun(", which makes the meander wider.", {}),
    );
    const rects = runRects(d, { preset: "body" }, paper, { w: 400, h: 300 }, (a) => !!a.highlight);
    expect(rects.length).toBeGreaterThan(1);
    rects.forEach((r, k) => {
      expect(r.attrs.highlight).toBe(2);
      expect(r.line).toBe((rects[0]?.line ?? 0) + k);
      expect(r.x + r.w).toBeLessThanOrEqual(400 + 0.5);
    });
    // A continuation line starts at the left edge; the first line starts after the plain words.
    expect(rects[1]?.x).toBe(0);
    expect(rects[0]?.x).toBeGreaterThan(0);
    expect(rects[1]?.y).toBeGreaterThan(rects[0]?.y ?? 0);
    expect(HIGHLIGHT_SLOTS).toBe(4);
    expect(runStyleOf(styledRun("a", { color: "#123456", highlight: 2 }))).toEqual({
      color: "#123456",
      highlight: 2,
    });
  });

  test("rect heights follow the line box, and the doc height agrees with measureHeadless", () => {
    const d = doc(styledRun(TEXT, { highlight: 1 }));
    const rects = runRects(d, { preset: "body" }, paper, { w: 300, h: 1000 }, () => true);
    const last = rects.at(-1);
    const height = measureHeadless(paper)({
      doc: d,
      width: 300,
      style: { preset: "body" },
      preset: "body",
      inset: 0,
      chrome: 0,
    });
    expect(Math.abs((last?.y ?? 0) + (last?.h ?? 0) - height)).toBeLessThan(0.5);
    for (const r of rects) expect(r.baseline).toBeGreaterThan(r.y + r.h / 2);
  });

  test("centred text shifts each rect by half its line's slack; picks nothing, returns nothing", () => {
    const d = doc(styledRun("short", { strikeStep: 2 }));
    const [left] = runRects(d, { preset: "body" }, paper, { w: 400, h: 100 }, () => true);
    const [mid] = runRects(
      d,
      { preset: "body", align: "center" },
      paper,
      { w: 400, h: 100 },
      () => true,
    );
    expect((mid?.x ?? 0) - (left?.x ?? 0)).toBeCloseTo((400 - (left?.w ?? 0)) / 2, 0);
    expect(
      runRects(d, { preset: "body" }, paper, { w: 400, h: 100 }, (a) => !!a.highlight),
    ).toEqual([]);
  });
});

describe("runRects with emoji, ZWJ sequences, combining marks and RTL (review of #529)", () => {
  const doc = (...runs: ReturnType<typeof styledRun>[]): RichDoc => ({
    type: "doc",
    content: [{ type: "paragraph", content: runs }],
  });
  const hl = (d: RichDoc, w = 400) =>
    runRects(d, { preset: "body" }, paper, { w, h: 300 }, (a) => !!a.highlight);
  const CASES: [string, string][] = [
    ["an emoji", "Bats 🦇 see"],
    ["a ZWJ family", "the 👨‍👩‍👧 family"],
    ["a skin-tone wave", "wave 👋🏽 hello"],
    ["combining marks", "café naïve"],
  ];

  for (const [name, text] of CASES) {
    test(`${name} in a highlighted run is one rect, after the plain words`, () => {
      const rects = hl(
        doc(styledRun("Plain words first then ", {}), styledRun(text, { highlight: 1 })),
      );
      expect(rects.length).toBe(1);
      expect(rects[0]?.x).toBeGreaterThan(0);
      expect(rects[0]?.w).toBeGreaterThan(0);
    });

    test(`${name} that wraps keeps every rect on its own consecutive line`, () => {
      const rects = hl(
        doc(styledRun(`${text} ${text} ${text} ${text} ${text}`, { highlight: 3 })),
        160,
      );
      expect(rects.length).toBeGreaterThan(1);
      rects.forEach((r, k) => {
        expect(r.line).toBe(k);
        expect(r.w).toBeGreaterThan(0);
      });
    });
  }

  test("a combining mark takes no room: e + U+0301 is as wide as the bare e", () => {
    const [a] = hl(doc(styledRun("cafe\u0301", { highlight: 1 })));
    const [b] = hl(doc(styledRun("cafe", { highlight: 1 })));
    expect(a?.w).toBeCloseTo(b?.w ?? 0, 6);
  });

  test("a ZWJ family is one glyph wide, not five", () => {
    const [one] = hl(doc(styledRun("👨", { highlight: 1 })));
    const [fam] = hl(doc(styledRun("👨‍👩‍👧", { highlight: 1 })));
    expect(fam?.w).toBeCloseTo((one?.w ?? 0) * 3, 6);
  });

  test("a paragraph with right-to-left text gets no rect rather than a misplaced one", () => {
    expect(hl(doc(styledRun("שלום", { highlight: 1 })))).toEqual([]);
    expect(hl(doc(styledRun("Rome ", { highlight: 1 }), styledRun("مرحبا", {})))).toEqual([]);
    // Other paragraphs keep theirs.
    const two: RichDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [styledRun("שלום", { highlight: 1 })] },
        { type: "paragraph", content: [styledRun("Rome", { highlight: 1 })] },
      ],
    };
    expect(hl(two).length).toBe(1);
  });

  test("lineOfOffset inside a surrogate pair answers the emoji's line", () => {
    const text = "Bats and owls hunt by night 🦇 and see";
    const i = text.indexOf("🦇");
    const at = lineOfOffset(text, i, "body", paper, 120);
    expect(at).toBeGreaterThan(0);
    expect(lineOfOffset(text, i + 1, "body", paper, 120)).toBe(at);
  });
});
