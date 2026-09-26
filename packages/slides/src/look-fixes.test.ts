import { describe, expect, test } from "bun:test";
import type { Slide, SlideElement } from "@tj/domain/documents";
import { chooseVariant } from "./choose-variant";
import { fitSlide } from "./fit-slide";
import { DIAGRAM_NAME } from "./look";
import { lookAndFitPages, materialiseSlide } from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import { docPlainText, joinSentences, sentences } from "./sentences";
import { ANSWERS_NAME } from "./structure";
import { getTheme } from "./themes";

const meta = { promptVersion: "t", model: "m", at: "2026-09-26T00:00:00.000Z" };
const THEMES = ["chalk", "exam-hall", "night-lab"];
const named = (els: SlideElement[], name: string) => els.filter((e) => e.name === name);
const texts = (s: Slide) =>
  s.elements.flatMap((e) => (e.type === "text" ? [docPlainText(e.doc)] : []));
const overlaps = (a: SlideElement, b: SlideElement) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Coasts slide 6 (gen2): a 44-word body beside a comparison diagram. */
const COASTS =
  "Sea walls are strong shore barriers: at Dawlish, one shields the railway from storm waves. Groynes are low fences built out across the beach. They trap sediment moved by longshore drift, so the beach stays wide and absorbs wave energy before it reaches the cliffs.";

describe("a body beside a diagram slot", () => {
  for (const id of THEMES) {
    test(`${id}: a 44-word body fits its column; the slot runs to the foot of the safe area`, () => {
      const t = getTheme(id);
      const slide = materialiseSlide(
        {
          kind: "content",
          factRefs: [],
          heading: "Sea walls shield land; groynes trap beach sediment",
          body: COASTS,
          diagram: "Comparison: sea wall along shore shields land; groyne traps sediment",
        },
        id,
        meta,
      );
      for (const page of lookAndFitPages(slide, t)) {
        expect(fitSlide(page, t).overflow).toEqual([]);
        const slot = named(page.elements, DIAGRAM_NAME)[0];
        if (!slot) continue;
        expect(slot.y + slot.h).toBeLessThanOrEqual(SAFE_BOTTOM);
        for (const e of page.elements) {
          if (e === slot || e.type !== "text" || e.style.preset !== "body") continue;
          expect(overlaps(e, slot)).toBe(false);
          expect(e.y + e.h).toBeLessThanOrEqual(SAFE_BOTTOM);
        }
      }
    });
  }

  test("a body too long for the column even a step down continues on the next slide, full measure", () => {
    const t = getTheme("chalk");
    const body = Array.from(
      { length: 8 },
      (_, i) => `Point ${i} adds a sentence of detail here.`,
    ).join(" ");
    const slide = materialiseSlide(
      { kind: "content", factRefs: [], heading: "Long", body, diagram: "Parts: a cliff" },
      "chalk",
      meta,
    );
    const pages = lookAndFitPages(slide, t);
    expect(pages.length).toBe(2);
    expect(named(pages[0]?.elements ?? [], DIAGRAM_NAME)).toHaveLength(1);
    expect(named(pages[1]?.elements ?? [], DIAGRAM_NAME)).toHaveLength(0);
    for (const page of pages) expect(fitSlide(page, t).overflow).toEqual([]);
    expect(pages.flatMap(texts).join(" ")).toContain("Point 7 adds a sentence of detail here.");
  });
});

describe("sentence split and join keep their spaces", () => {
  test("a stop with a closing bracket or quote ends a sentence; a decimal point does not", () => {
    expect(
      sentences("Power over others (influence). A win. He said “no.” Then 3.5 m went."),
    ).toEqual(["Power over others (influence).", "A win.", "He said “no.”", "Then 3.5 m went."]);
    expect(sentences("Why? Because! Done")).toEqual(["Why?", "Because!", "Done"]);
    expect(joinSentences(["A.", " B. ", ""])).toBe("A. B.");
  });

  test("paragraphs join with a space", () => {
    expect(
      docPlainText({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "others)." }] },
          { type: "paragraph" },
          { type: "paragraph", content: [{ type: "text", text: "A successful" }] },
        ],
      }),
    ).toBe("others). A successful");
  });

  test("Romans slide 4: a two-paragraph body splits into lead and card with no word run together", () => {
    const slide = materialiseSlide(
      {
        kind: "content",
        factRefs: [],
        heading: "More land could bring Rome power and emperors respect",
        body: "Romans wanted to expand their empire (ruled lands), gaining power, wealth and influence (power over others).\n\nA successful invasion could bring an emperor fame and respect. Claudius’s AD 43 invasion showed strength.",
      },
      "chalk",
      meta,
      undefined,
      0,
      { terms: ["empire", "influence", "invasion"] },
    );
    const words = texts(slide).join(" | ");
    expect(words).toContain("(power over others).");
    expect(words).not.toMatch(/[.!?]["'”’)\]]*[A-Za-z]/);
  });
});

describe("the answers never cover the questions", () => {
  const plants = [
    "A sunflower in a pot is watered. Explain how the water helps the sunflower grow.",
    "Plants get all the water they need from the soil without taking any in. True or false? Explain.",
    "What is photosynthesis, and how does light help a plant make its food?",
    "A young plant is kept in a cool room. Why might it grow more slowly than one kept warm?",
    "Name two things a plant needs from its surroundings to stay healthy and grow.",
  ];
  const answers =
    "Answers: 1 Its roots take in water from the soil; the water moves up the stem to the leaves  ·  2 False: roots take water in  ·  3 Plants make food using light  ·  4 Cold slows the jobs a plant does to grow  ·  5 Water and light";
  for (const id of THEMES) {
    test(`${id}: a full open-question set gets the panel only below its last question, else an Answers slide`, () => {
      const t = getTheme(id);
      const slide = materialiseSlide(
        {
          kind: "exit-ticket",
          factRefs: [],
          heading: "Quick check",
          items: plants,
          footnote: answers,
        },
        id,
        meta,
      );
      const pages = lookAndFitPages(slide, t);
      for (const page of pages) {
        const fitted = fitSlide(page, t);
        expect(fitted.overflow).toEqual([]);
        const panel = named(fitted.slide.elements, ANSWERS_NAME)[0];
        if (!panel) continue;
        for (const e of fitted.slide.elements) {
          if (e === panel || e.name === "Accent bar" || e.name === "Kind tag") continue;
          if (e.name === "Heading") continue;
          expect(overlaps(e, panel)).toBe(false);
        }
      }
      const withAnswers = pages.filter((p) => named(p.elements, ANSWERS_NAME).length > 0);
      expect(withAnswers.length).toBeGreaterThan(0);
      const own = withAnswers.find((p) => texts(p).some((x) => x.endsWith(": answers")));
      if (own) {
        expect(own.question).toBeUndefined();
        expect(named(own.elements, ANSWERS_NAME)[0]?.revealStep).toBeUndefined();
      }
    });
  }

  test("a short set keeps its panel as a reveal on the same slide", () => {
    const t = getTheme("chalk");
    const slide = materialiseSlide(
      {
        kind: "exit-ticket",
        factRefs: [],
        heading: "Quick check",
        items: ["What do roots take in?", "Name one thing a plant needs."],
        footnote: "Answers: 1 Water  ·  2 Light",
      },
      "chalk",
      meta,
    );
    const pages = lookAndFitPages(slide, t);
    expect(pages).toHaveLength(1);
    expect(named(pages[0]?.elements ?? [], ANSWERS_NAME)[0]?.revealStep).toBe(1);
  });
});

describe("a diagram instruction always gets a layout that keeps the slot", () => {
  const spec = {
    kind: "content" as const,
    factRefs: [],
    heading: "Erosion",
    body: Array.from({ length: 6 }, () => "Waves wear the cliff away over time.").join(" "),
    diagram: "Parts: cliff, wave-cut notch, sea",
  };
  test("materialise lays a two-column or statement request out headed, with the slot", () => {
    for (const variant of ["two-column", "statement", 2, 1]) {
      const slide = materialiseSlide(spec, "chalk", meta, undefined, variant);
      expect(named(slide.elements, DIAGRAM_NAME)).toHaveLength(1);
    }
  });
  test("chooseVariant keeps a diagram slide headed, even after a headed slide", () => {
    const ctx = {
      index: 4,
      total: 10,
      textLength: 60,
      previousVariant: "headed",
      previousKind: "content" as const,
    };
    expect(chooseVariant("content", ctx)).toBe("two-column");
    expect(chooseVariant("content", { ...ctx, hasDiagram: true })).toBe("headed");
    expect(chooseVariant("content", { ...ctx, textLength: 10, hasDiagram: true })).toBe("headed");
  });
});

describe("a stored, already structured set", () => {
  test("its answers panel moves off the questions when restyled with pages", () => {
    const t = getTheme("chalk");
    const q = (id: string, y: number): SlideElement => ({
      id,
      type: "text",
      x: 58,
      y,
      w: 844,
      h: 38,
      name: "Question",
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: `Question ${id}?` }] }],
      },
      style: { preset: "body", fontSize: 24 },
    });
    const chip: SlideElement = {
      id: "c",
      type: "shape",
      shape: "rounded",
      x: 58,
      y: 196,
      w: 120,
      h: 48,
      name: "Option",
    };
    const panel: SlideElement = {
      id: "p",
      type: "shape",
      shape: "rounded",
      x: 58,
      y: 216,
      w: 844,
      h: 281,
      name: ANSWERS_NAME,
      revealStep: 1,
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "1 A" }] }],
      },
    };
    const slide: Slide = {
      id: "s",
      kind: "exit-ticket",
      elements: [q("a", 140), chip, q("b", 287), q("c2", 343), panel],
    };
    const pages = lookAndFitPages(slide, t);
    expect(pages).toHaveLength(2);
    expect(named(pages[0]?.elements ?? [], ANSWERS_NAME)).toHaveLength(0);
    expect(named(pages[1]?.elements ?? [], ANSWERS_NAME)).toHaveLength(1);
  });
});
