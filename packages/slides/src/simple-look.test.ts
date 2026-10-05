import { describe, expect, test } from "bun:test";
import type { Slide, TextElement } from "@tj/domain/documents";
import { ACCENT_BAR_NAME, KIND_TAG_NAME } from "./look";
import { materialiseSlide } from "./materialise";
import type { SlideSpec } from "./specs";
import { THEMES } from "./themes";

/*
 * The simple slide (Greg, 5 Oct 2026: "simple is best"): a slide is its heading and its content.
 * No slide-type labels, no foot bar, no decorative markers (rulings 159, 160). The cover's
 * eyebrow and class line wait on Greg and stay.
 */
const META = { promptVersion: "test", model: "test", at: "2026-10-05T00:00:00.000Z" };
const counter = () => {
  let n = 0;
  return () => `e${++n}`;
};
const named = (slide: Slide, name: string) => slide.elements.filter((e) => e.name === name);
const plain = (el: TextElement) =>
  JSON.stringify(el.doc)
    .match(/"text":"([^"]*)"/g)
    ?.map((m) => m.slice(8, -1))
    .join("") ?? "";
const texts = (slide: Slide) =>
  slide.elements.filter((e): e is TextElement => e.type === "text").map(plain);

const SPECS: SlideSpec[] = [
  { kind: "title", title: "Coastal erosion", subtitle: "Year 9 · Geography", factRefs: [] },
  { kind: "starter", heading: "Do now", items: ["What is sediment?"], factRefs: [] },
  {
    kind: "exit-ticket",
    heading: "Exit ticket",
    items: ["Name one type of erosion.", "Why do cliffs retreat?"],
    factRefs: [],
  } as SlideSpec,
  {
    kind: "content",
    heading: "Hydraulic action widens cracks",
    body: "Hydraulic action is erosion by trapped air. Waves force air into cracks and squeeze it.",
    factRefs: ["k1"],
  },
  {
    kind: "true-false",
    statement: "Sound travels through a vacuum.",
    correct: false,
    explanation: "Sound needs particles to pass the vibration on.",
    factRefs: ["q1"],
  },
];

describe("simple: no chrome", () => {
  for (const theme of THEMES) {
    for (const spec of SPECS) {
      test(`${theme.id} ${spec.kind}: no kind tag and no foot bar`, () => {
        const slide = materialiseSlide(spec, theme.id, META, counter());
        expect(named(slide, KIND_TAG_NAME)).toHaveLength(0);
        expect(named(slide, ACCENT_BAR_NAME)).toHaveLength(0);
        expect(
          texts(slide).some((t) => /^(CHECK|STARTER|PRACTISE|THINK|TALK|REVIEW)$/.test(t)),
        ).toBe(false);
      });
    }
  }
});

describe("simple: the cover (ruling 162)", () => {
  for (const theme of THEMES) {
    test(`${theme.id}: the title alone on the theme's ground, no eyebrow, year line or rule`, () => {
      const slide = materialiseSlide(SPECS[0] as SlideSpec, theme.id, META, counter());
      expect(texts(slide)).toEqual(["Coastal erosion"]);
      expect(slide.elements.some((e) => e.type === "shape" && e.name === "Accent rule")).toBe(
        false,
      );
      expect(slide.background?.color).toBeUndefined();
    });
  }
});
