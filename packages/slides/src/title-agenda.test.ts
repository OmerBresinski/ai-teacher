import { describe, expect, test } from "bun:test";
import { fitsPlanned } from "./fit-check";
import { fitSlide } from "./fit-slide";
import { AGENDA_DIVIDER, AGENDA_OBJECTIVES, AGENDA_STEM } from "./layouts";
import { materialiseSlide } from "./materialise";
import type { SlideSpec } from "./specs";
import { getTheme, THEMES } from "./themes";

/** Real titles and objectives from the designer's round-3 decks (the longest of each shape). */
const DECKS: { title: string; subtitle: string; objectives: string[] }[] = [
  {
    title: "Electrolysis of aqueous solutions: predicting the products at each electrode",
    subtitle: "Year 10 · Chemistry",
    objectives: [
      "Explain how metal reactivity and hydrogen ions determine the cathode product",
      "Explain how halide ions and hydroxide ions determine the anode product",
    ],
  },
  {
    title: "plants and trees",
    subtitle: "Year 4 · Science",
    objectives: [
      "Explain how roots take in water and hold a plant in the soil, and how stems carry water.",
      "Explain how leaves use light, water and air to make food for a plant.",
      "Explain how flowers help a plant make seeds that can grow into new plants.",
    ],
  },
  {
    title: "Rivers: the journey of a river from source to mouth",
    subtitle: "Year 5 · Geography",
    objectives: [
      "Explain how water travels from a river’s source, through tributaries and confluences, to its mouth",
      "Explain how a river’s valley and channel change from its upper course to its lower course",
    ],
  },
  {
    title: "Solving linear equations with unknowns on both sides",
    subtitle: "Year 11 · Maths",
    objectives: [
      "Explain how collecting variable terms and constants isolates the unknown while preserving equality",
    ],
  },
];

/** Three objectives of ninety characters: more than the right column holds on every theme. */
const WEIMAR = {
  title: "Weimar Germany: the hyperinflation crisis of 1923",
  subtitle: "Year 9 · History",
  objectives: [
    "Explain how the Ruhr occupation and passive resistance led to money-printing and rising prices",
    "Explain how hyperinflation affected workers, savers and people with fixed incomes",
    "Explain how the Rentenmark and ending passive resistance helped stabilise the currency",
  ],
};

const spec = (d: (typeof DECKS)[number]): SlideSpec => ({ kind: "title", factRefs: [], ...d });
const meta = { promptVersion: "test", model: "none", at: "2026-09-30T00:00:00Z" };

describe("title, agenda (objectives on the title slide)", () => {
  test("a title with objectives takes the agenda variant: stem, numbered objectives, divider", () => {
    const slide = materialiseSlide(spec(WEIMAR), "chalk", meta);
    const names = slide.elements.map((e) => e.name);
    expect(names).toContain(AGENDA_DIVIDER);
    expect(names).toContain(AGENDA_STEM);
    const list = slide.elements.find((e) => e.name === AGENDA_OBJECTIVES);
    expect(JSON.stringify(list)).toContain("explain how hyperinflation affected workers");
  });

  test("a title without objectives keeps the stack", () => {
    const slide = materialiseSlide(
      { kind: "title", factRefs: [], title: "Rocks", subtitle: "Year 3" },
      "chalk",
      meta,
    );
    expect(slide.elements.some((e) => e.name === AGENDA_STEM)).toBe(false);
  });

  test("real round-3 titles and objectives fit on every theme (one step down, as the designer asks)", () => {
    expect(THEMES.length).toBe(10);
    for (const d of DECKS) {
      const { failing } = fitsPlanned(spec(d), { stepDown: 1 });
      expect({ title: d.title, failing: failing.map((f) => f.theme) }).toEqual({
        title: d.title,
        failing: [],
      });
    }
    // Too much for the column: the check says so, and the designer keeps the objectives slide.
    expect(fitsPlanned(spec(WEIMAR), { stepDown: 1 }).ok).toBe(false);
  });

  test("fitted, the two columns do not overlap and stay inside the safe area", () => {
    for (const theme of THEMES) {
      for (const d of DECKS) {
        const slide = fitSlide(materialiseSlide(spec(d), theme.id, meta), getTheme(theme.id)).slide;
        const texts = slide.elements.filter((e) => e.type === "text");
        for (const t of texts) {
          expect(t.y).toBeGreaterThanOrEqual(43);
          expect(t.y + t.h).toBeLessThanOrEqual(497 + 1);
        }
        const divider = slide.elements.find((e) => e.name === AGENDA_DIVIDER);
        const left = texts.filter((t) => t.x < (divider?.x ?? 0));
        const right = texts.filter((t) => t.x > (divider?.x ?? 0));
        expect(right.length).toBe(2);
        for (const t of left) expect(t.x + t.w).toBeLessThan(divider?.x ?? 0);
        for (const t of right) expect(t.x).toBeGreaterThan(divider?.x ?? 0);
      }
    }
  });
});
