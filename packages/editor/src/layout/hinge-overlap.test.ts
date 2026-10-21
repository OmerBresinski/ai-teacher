import { describe, expect, test } from "bun:test";
import {
  type Lesson,
  richDocToPlainText,
  type Slide,
  type TextElement,
} from "@tj/domain/documents";
import { countLines, measureHeadless } from "@tj/slides";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { getTheme } from "../model/themes";
import LIVE from "./fixtures/hinge-y2-plants-s9.json" with { type: "json" };
import { rethemeLesson } from "./retheme";

/*
 * TEACH-256 part c: live run 20261016-1221 y2-plants s9, a hinge laid in Splash (the lesson's own
 * theme). Its option rows were sized for one line each; drawn in Paper the long options wrap to two
 * lines and ran over the next card. Replayed here in both themes: no option's words may leave its
 * card and no two cards may overlap.
 */
const INPUT = {
  template: "hinge",
  heading: "Which plan fairly tests how water amount affects growth?",
  options: [
    "Different water amounts; same light, plants, soil and pots.",
    "Different water amounts and different amounts of light.",
    "Same water amount; different amounts of light.",
  ],
  correct: 1,
} as TemplateInput;

/** Every way an option's drawn words or card cross another, measured in `themeId`'s faces. */
function overlaps(slide: Slide, themeId: string): string[] {
  const theme = getTheme(themeId);
  const cards = slide.elements.filter((e) => e.name === "Option").sort((a, b) => a.y - b.y);
  const out: string[] = [];
  for (let k = 1; k < cards.length; k++) {
    const a = cards[k - 1] as Slide["elements"][number];
    const b = cards[k] as Slide["elements"][number];
    const sideBySide = a.x + a.w <= b.x || b.x + b.w <= a.x;
    if (!sideBySide && a.y + a.h > b.y + 0.5) out.push(`card ${k - 1} runs into card ${k}`);
  }
  for (const t of slide.elements.filter((e) => e.name === "Option text") as TextElement[]) {
    const card = cards.find(
      (c) => t.x >= c.x && t.x + t.w <= c.x + c.w + 0.5 && t.y >= c.y && t.y < c.y + c.h,
    );
    const text = richDocToPlainText(t.doc);
    if (!card) {
      out.push(`"${text}" sits in no card`);
      continue;
    }
    const size = t.style?.fontSize ?? 0;
    const lines = countLines(text, "body", theme, t.w, t.style?.fontWeight, size);
    const bottom = t.y + lines * size * (t.style?.lineHeight ?? 1.24);
    if (bottom > card.y + card.h + 0.5)
      out.push(
        `"${text}" (${lines} lines) ends at ${Math.round(bottom)}, card at ${card.y + card.h}`,
      );
  }
  return out;
}

const lessonIn = (themeId: string, slide: Slide) =>
  ({
    id: "l",
    title: "What plants need to grow",
    themeId,
    ageBand: "ks2",
    yearGroup: "Year 4",
    slides: [slide],
  }) as unknown as Lesson;

describe("hinge y2-plants s9: option cards hold their wrapped words", () => {
  for (const th of ["splash", "paper"])
    test(`laid in ${th}: no option overlaps`, () => {
      const r = layoutTemplate(INPUT, getTheme(th), "ks2");
      expect(r.slide.elements.filter((e) => e.name === "Option")).toHaveLength(3);
      expect(overlaps(r.slide as Slide, th)).toEqual([]);
    });

  test("the live slide in its own theme (splash): no option overlaps", () => {
    expect(overlaps(LIVE as unknown as Slide, "splash")).toEqual([]);
  });

  test("the live slide switched from splash to paper: no option overlaps", () => {
    const { lesson } = rethemeLesson(
      lessonIn("splash", LIVE as unknown as Slide),
      "paper",
      measureHeadless(getTheme("paper")),
    );
    expect(overlaps(lesson.slides[0] as Slide, "paper")).toEqual([]);
  });
});
