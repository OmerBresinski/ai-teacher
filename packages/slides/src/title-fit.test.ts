import { describe, expect, test } from "bun:test";
import type { RichDoc, TextElement } from "@tj/domain/documents";
import { layoutTemplate, type Stage } from "./templates/index";
import { fittedFontSize, growFixedText, measureHeadless } from "./text-measure";
import { resolveTextStyle } from "./text-style";
import { atKeyStage, fontFloor, THEMES } from "./themes";

/*
 * TEACH-75 part o: the title slide's title stands on the foot of a fixed-height box sized exactly to
 * its words. A teacher's edit that adds a line ran out of the top of the box, so the first line
 * ("The heart") was cut off in Present. The renderer now draws such a box at `fittedFontSize`.
 */

const STAGES: Stage[] = ["ks1", "ks2", "ks3", "ks4", "ks5"];
const TITLES = [
  "The heart and circulatory system",
  "The eye: structure, focusing and defects",
  "Inside plant and animal cells",
  "Rivers: the journey of a river from source to mouth",
];
const EDITS = ["TPFIRST", "today and tomorrow", "and how blood moves round the body"];
const SLIDE = { w: 960, h: 540 };

const withText = (el: TextElement, text: string): TextElement => ({
  ...el,
  doc: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  } as RichDoc,
});

/**
 * Height the box's words take at `size`. A fitted size is checked as narrow as the fit measures it;
 * the stored size is checked at the box's width, as the generator measured it.
 */
function needAt(
  el: TextElement,
  theme: Parameters<typeof measureHeadless>[0],
  size: number,
  fitted: boolean,
) {
  const style = el.style ?? {};
  return measureHeadless(theme)({
    doc: el.doc,
    width: fitted ? el.w * 0.94 : el.w,
    style,
    preset: style.preset ?? "body",
    fontSize: size,
    inset: 0,
    chrome: 0,
  });
}

describe("a long title fits its zone on every theme, KS1 to KS5 (TEACH-75 part o)", () => {
  for (const base of THEMES)
    for (const stage of STAGES) {
      const theme = atKeyStage(base, stage);
      test(`${base.id} ${stage}`, () => {
        const floor = fontFloor("heading");
        for (const heading of TITLES) {
          const r = layoutTemplate(
            {
              template: "title",
              heading,
              lead: "Recall: what changes in your body when you run?",
              figure: { photo: "x.jpg", aspect: 4 / 3, alt: "a river" },
            },
            theme,
            stage,
          );
          const title = r.slide.elements.find((e) => e.name === "Title") as TextElement;
          // As generated: the box is on the slide and its words fit it at their stored size.
          expect(title.y).toBeGreaterThanOrEqual(0);
          expect(title.y + title.h).toBeLessThanOrEqual(SLIDE.h);
          expect(title.x + title.w).toBeLessThanOrEqual(SLIDE.w);
          expect(fittedFontSize(title, theme)).toBeUndefined();

          for (const edit of EDITS) {
            const edited = withText(title, `${heading} ${edit}`);
            const stored = resolveTextStyle(edited.style, theme, "title").fontSize;
            const fitted = fittedFontSize(edited, theme);
            const size = fitted ?? stored;
            const label = `${heading} + ${edit} @ ${size}`;
            // Readable: never under the heading's projector floor (26pt).
            expect(size, label).toBeGreaterThanOrEqual(floor);
            // No ink outside the box, so none outside the slide, top or bottom.
            expect(needAt(edited, theme, size, fitted !== undefined), label).toBeLessThanOrEqual(
              edited.h + 1,
            );
          }
        }
      });
    }
});

describe("fittedFontSize leaves other boxes alone", () => {
  const theme = atKeyStage(THEMES[0] as (typeof THEMES)[number], "ks3");
  const long = withText(
    {
      id: "t",
      type: "text",
      x: 64,
      y: 64,
      w: 300,
      h: 80,
      doc: { type: "doc", content: [] },
      style: { preset: "title", autoHeight: false },
    } as unknown as TextElement,
    "A title far too long for a box of this height in any theme",
  );

  test("an auto-height box grows instead", () => {
    expect(fittedFontSize({ ...long, style: { preset: "title" } }, theme)).toBeUndefined();
  });

  test("autoFit: false opts out", () => {
    expect(
      fittedFontSize({ ...long, style: { ...long.style, autoFit: false } }, theme),
    ).toBeUndefined();
  });

  test("an overflowing fixed box steps down, never under the floor", () => {
    const size = fittedFontSize(long, theme);
    expect(size).toBeDefined();
    expect(size as number).toBeGreaterThanOrEqual(fontFloor("heading"));
  });
});

describe("a title too long for the floor grows its box and pushes the subtitle (TEACH-75 part o)", () => {
  const huge =
    "The heart and circulatory system and how the blood carries oxygen from the lungs round the body, then back to the heart through arteries, veins and capillaries";
  for (const base of THEMES)
    for (const stage of STAGES) {
      const theme = atKeyStage(base, stage);
      test(`${base.id} ${stage}`, () => {
        const r = layoutTemplate(
          {
            template: "title",
            heading: "The heart",
            lead: "Recall: what changes in your body when you run?",
            figure: { photo: "x.jpg", aspect: 4 / 3, alt: "a runner" },
          },
          theme,
          stage,
        );
        const els = r.slide.elements.map((e) =>
          e.name === "Title" ? withText(e as TextElement, huge) : e,
        );
        const grown = growFixedText(els, theme);
        const title = grown.find((e) => e.name === "Title") as TextElement;
        const sub = grown.find((e) => e.name === "Subtitle") as TextElement;
        const fitted = fittedFontSize(title, theme);
        const size = fitted ?? resolveTextStyle(title.style, theme, "title").fontSize;
        expect(size).toBeGreaterThanOrEqual(fontFloor("heading"));
        expect(needAt(title, theme, size, fitted !== undefined)).toBeLessThanOrEqual(title.h + 1);
        expect(title.y).toBeGreaterThanOrEqual(0);
        expect(sub.y).toBeGreaterThanOrEqual(title.y + title.h - 1);
        expect(sub.y + sub.h).toBeLessThanOrEqual(SLIDE.h);
      });
    }
});
