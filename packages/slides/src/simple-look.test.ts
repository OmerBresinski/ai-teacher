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

describe("simple: question sets and the objectives are plain numbered lists (ruling 162)", () => {
  const long = [
    "Explain how passive resistance led the government to print more money in 1923.",
    "Why could hyperinflation harm a saver but help someone with a fixed debt in marks?",
    "Explain how ending passive resistance and the Rentenmark helped stabilise Germany.",
  ];
  const specs: SlideSpec[] = [
    { kind: "exit-ticket", heading: "Exit ticket", items: long, factRefs: [] } as SlideSpec,
    {
      kind: "starter",
      heading: "Quick check",
      items: long,
      footnote: `Answers: ${long.map((_, i) => `${i + 1} A full sentence that answers question ${i + 1} at length, as a teacher would.`).join("  ·  ")}`,
      factRefs: [],
    } as SlideSpec,
    {
      kind: "objectives",
      items: ["explain one thing", "compare two things"],
      factRefs: [],
    } as SlideSpec,
  ];
  for (const theme of THEMES) {
    for (const spec of specs) {
      test(`${theme.id} ${spec.kind}: no card, no disc, no reserved answer room`, () => {
        const slide = materialiseSlide(spec, theme.id, META, counter());
        expect(named(slide, "Row card")).toHaveLength(0);
        expect(slide.elements.some((e) => e.type === "shape" && e.shape === "ellipse")).toBe(false);
        const rows = slide.elements
          .filter(
            (e): e is TextElement =>
              e.type === "text" && /^(Row text|Row reveal|Objective \d)$/.test(e.name ?? ""),
          )
          .sort((a, b) => a.y - b.y);
        expect(rows.length).toBeGreaterThan(1);
        // Rows (and a hidden answer under its question) follow at a reading gap: no empty card room.
        let foot = (rows[0] as TextElement).y + (rows[0] as TextElement).h;
        for (const r of rows.slice(1)) {
          expect(r.y - foot).toBeLessThanOrEqual(48);
          foot = Math.max(foot, r.y + r.h);
        }
      });
    }
  }
});

describe("simple: the hinge grid at body size (ruling 161)", () => {
  const mc = (texts: string[]) =>
    ({
      kind: "multiple-choice",
      stem: "Which explanation best links printing money to hyperinflation in 1923?",
      options: texts.map((text, i) => ({ text, correct: i === 1 })),
      explanation: "More money chased fewer goods.",
      factRefs: [],
    }) as SlideSpec;
  for (const theme of THEMES) {
    test(`${theme.id}: short options stay a 2×2 grid, set at body size`, () => {
      const slide = materialiseSlide(
        mc(["More money", "Fewer goods", "Lower taxes", "More coal"]),
        theme.id,
        META,
        counter(),
      );
      const opts = slide.elements.filter((e) => e.type === "option");
      expect(opts).toHaveLength(4);
      expect(new Set(opts.map((o) => o.x)).size).toBe(2);
      for (const o of opts) if (o.type === "option") expect(o.textStyle?.preset).toBe("body");
    });
  }
  for (const id of ["studio", "night-lab"])
    test(`${id}: y9's four sentence options (two lines in a card) are the grid`, () => {
      const slide = materialiseSlide(
        mc([
          "It created more goods for people to buy.",
          "It increased money while output fell.",
          "It cancelled Germany's reparations.",
          "It made the Ruhr produce more coal.",
        ]),
        id,
        META,
        counter(),
      );
      const opts = slide.elements.filter((e) => e.type === "option");
      expect(new Set(opts.map((o) => o.x)).size).toBe(2);
    });
  test("long options take the single column", () => {
    const long =
      "Printing more money while output fell meant more marks chased fewer goods, so prices kept rising";
    const slide = materialiseSlide(mc([long, long, long, long]), "studio", META, counter());
    const opts = slide.elements.filter((e) => e.type === "option");
    expect(new Set(opts.map((o) => o.x)).size).toBe(1);
  });
});
