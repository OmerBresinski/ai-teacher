import { describe, expect, test } from "bun:test";
import type { Slide, SlideElement } from "@tj/domain/documents";
import { chooseVariant } from "./choose-variant";
import { fitSlide } from "./fit-slide";
import { SAFE } from "./grid";
import {
  applyLook,
  COUNTER_NAME,
  counterRoom,
  DIAGRAM_NAME,
  EYEBROW_NAME,
  HEADING_DISPLAY,
  KIND_TAG_NAME,
  stripLook,
  withDeckChrome,
} from "./look";
import { lookAndFitPages, materialiseSlide } from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import { docPlainText, joinSentences, sentences } from "./sentences";
import {
  ANSWERS_NAME,
  BULLET_NAME,
  ITEM_NAME,
  PANEL_DEFINITION_NAME,
  PANEL_NAME,
  withoutDefinition,
} from "./structure";
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

  test("a body too long for the column even a step down continues on the next slide, full measure, the slot kept", () => {
    const t = getTheme("chalk");
    const body = Array.from(
      { length: 16 },
      (_, i) => `Point ${i} adds a sentence of detail here.`,
    ).join(" ");
    const slide = materialiseSlide(
      { kind: "content", factRefs: [], heading: "Long", body, diagram: "Parts: a cliff" },
      "chalk",
      meta,
    );
    const pages = lookAndFitPages(slide, t);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    // The drawing keeps its space on the first slide; the words continue across the full measure.
    expect(named(pages[0]?.elements ?? [], DIAGRAM_NAME)).toHaveLength(1);
    for (const page of pages.slice(1)) expect(named(page.elements, DIAGRAM_NAME)).toHaveLength(0);
    for (const page of pages) expect(fitSlide(page, t).overflow).toEqual([]);
    expect(pages.flatMap(texts).join(" ")).toContain("Point 15 adds a sentence of detail here.");
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

test("an answers slide's card is measured for its own words, inside the safe area", () => {
  const t = getTheme("chalk");
  const long = Array.from(
    { length: 4 },
    (_, i) =>
      `${i + 1} An answer that runs over most of two lines on the slide, with a reason after it.`,
  ).join("  ·  ");
  const slide = materialiseSlide(
    {
      kind: "exit-ticket",
      factRefs: [],
      heading: "Exit ticket",
      items: ["One?", "Two?", "Three?", "Four?", "Five?", "Six?"],
      footnote: `Answers: ${long}`,
    },
    "chalk",
    meta,
  );
  for (const page of lookAndFitPages(slide, t)) {
    const panel = named(page.elements, ANSWERS_NAME)[0];
    if (!panel || panel.revealStep) continue;
    expect(panel.y + panel.h).toBeLessThanOrEqual(SAFE_BOTTOM);
  }
});

describe("design pass", () => {
  const t = getTheme("chalk");
  const slide = (body: string, heading = "Limiting factors") =>
    materialiseSlide(
      { kind: "content", factRefs: [], heading, body },
      "chalk",
      meta,
      undefined,
      0,
      {
        terms: ["abrasion", "hydraulic action", "erosion"],
        glossary: [
          { term: "abrasion", definition: "Rock worn away by sediment the waves throw at it." },
        ],
      },
    );

  /** An activity slide's top line: a kind tag in the lane above the heading. */
  const tagged = (s: Slide): Slide => ({
    ...s,
    elements: [
      ...s.elements,
      {
        id: "tag",
        type: "text",
        x: SAFE.x + 40,
        y: SAFE.y,
        w: 95,
        h: 28,
        name: KIND_TAG_NAME,
        doc: { type: "doc", content: [] },
        style: { preset: "caption" },
      },
    ],
  });

  test("the deck chrome: the tag at the left, the counter at the right, no year and subject", () => {
    const s = tagged(slide("Waves wear cliffs away. Abrasion scrapes the rock."));
    const [out] = withDeckChrome([s, s], t);
    const tag = named(out?.elements ?? [], KIND_TAG_NAME)[0];
    const counter = named(out?.elements ?? [], COUNTER_NAME)[0];
    expect(named(out?.elements ?? [], EYEBROW_NAME)).toHaveLength(0);
    expect(tag?.x).toBe(SAFE.x);
    expect(counter?.y).toBe(tag?.y);
    expect(counter && counter.type === "text" && docPlainText(counter.doc)).toBe("1 / 2");
    expect((counter?.x ?? 0) + (counter?.w ?? 0)).toBe(SAFE.x + SAFE.w);
    // Re-run: replaced, not doubled.
    const again = withDeckChrome(withDeckChrome([s], t), t);
    expect(named(again[0]?.elements ?? [], COUNTER_NAME)).toHaveLength(1);
  });

  test("a stored deck line is taken off and the tag moves back to the margin", () => {
    const s = tagged(slide("Waves wear cliffs away. Abrasion scrapes the rock."));
    const [once] = withDeckChrome([s], t);
    const tag = named(once?.elements ?? [], KIND_TAG_NAME)[0];
    const old = {
      ...(once as Slide),
      elements: [
        ...(once?.elements ?? []).map((e) => (e === tag ? { ...e, x: SAFE.x + 180 } : e)),
        { ...(tag as SlideElement), id: "old-eyebrow", name: EYEBROW_NAME },
      ],
    };
    const [out] = withDeckChrome([old], t);
    expect(named(out?.elements ?? [], EYEBROW_NAME)).toHaveLength(0);
    expect(named(out?.elements ?? [], KIND_TAG_NAME)[0]?.x).toBe(SAFE.x);
  });

  test("no empty right half: a lesson term the words use fills the panel with its definition", () => {
    const s = slide(
      "Waves erode cliffs in two ways. Abrasion scrapes rock with sediment. Hydraulic action forces air into cracks.",
    );
    const panelText = named(s.elements, PANEL_DEFINITION_NAME)[0];
    expect(panelText && panelText.type === "text" && docPlainText(panelText.doc)).toContain(
      "Rock worn away",
    );
    expect(fitSlide(s, t).overflow).toEqual([]);
  });

  test("a lead and short points become dot bullets, one dot a point", () => {
    const s = slide(
      "The rate is limited by the factor in shortest supply. Light intensity matters. Carbon dioxide matters. Temperature matters.",
    );
    expect(named(s.elements, BULLET_NAME)).toHaveLength(3);
    expect(named(s.elements, ITEM_NAME)).toHaveLength(3);
    expect(named(s.elements, PANEL_NAME)).toHaveLength(1);
  });

  test("key terms: the first use only, and at most two a slide, even when styled twice", () => {
    const s = slide(
      "Erosion wears cliffs. Abrasion scrapes; abrasion again. Hydraulic action cracks rock. Erosion again.",
    );
    const twice = lookAndFitPages(s, t, undefined, {
      terms: ["abrasion", "hydraulic action", "erosion"],
    })[0] as Slide;
    const chips = JSON.stringify(twice).match(/"bold"\},\{"type":"textStyle"/g) ?? [];
    expect(chips.length).toBeLessThanOrEqual(2);
  });

  test("one heading size across teaching slides: a long heading wraps at the display size, beside the counter", () => {
    const short = named(slide("One idea. Two ideas.").elements, "Heading")[0];
    const long = named(
      slide(
        "One idea. Two ideas.",
        "Sea walls shield the land behind them while groynes trap the beach sediment",
      ).elements,
      "Heading",
    )[0];
    expect(short?.type === "text" && short.style.fontSize).toBe(
      Math.round(t.sizes.heading * HEADING_DISPLAY),
    );
    expect(long?.type === "text" && long.style.fontSize).toBe(
      Math.round(t.sizes.heading * HEADING_DISPLAY),
    );
    expect(long?.h).toBeGreaterThan((short?.h ?? 0) * 1.5);
    // It leaves the top-right corner to the counter.
    expect((long?.x ?? 0) + (long?.w ?? 0)).toBeLessThanOrEqual(SAFE.x + SAFE.w - counterRoom(t));
  });
});

describe("merged: points, the diagram panel, the definition said once, the deck line", () => {
  const t = getTheme("chalk");
  test("a content spec's points are dot bullets under the lead, beside the panel", () => {
    const s = materialiseSlide(
      {
        kind: "content",
        factRefs: [],
        heading: "Limiting factors",
        body: "The rate is limited by whichever factor is in shortest supply.",
        points: ["light intensity", "carbon dioxide", "temperature"],
      },
      "chalk",
      meta,
    );
    expect(named(s.elements, BULLET_NAME)).toHaveLength(3);
    expect(
      named(s.elements, ITEM_NAME).map((e) => (e.type === "text" ? docPlainText(e.doc) : "")),
    ).toEqual(["light intensity", "carbon dioxide", "temperature"]);
    expect(fitSlide(s, t).overflow).toEqual([]);
  });

  test("a diagram slot is the right panel: tinted, the words beside it", () => {
    const s = materialiseSlide(
      {
        kind: "content",
        factRefs: [],
        heading: "Cliff erosion",
        body: "Waves wear cliffs away. Abrasion scrapes rock. Hydraulic action cracks it.",
        diagram: "Parts: cliff, notch, sea",
      },
      "chalk",
      meta,
    );
    const slot = named(s.elements, DIAGRAM_NAME)[0];
    expect(slot && slot.type === "shape" && slot.strokeWidth).toBe(0);
    expect(named(s.elements, PANEL_NAME)).toHaveLength(0);
    for (const e of s.elements) {
      if (e.type === "text" && e.style.preset === "body")
        expect(e.x + e.w).toBeLessThanOrEqual(slot?.x ?? 0);
    }
  });

  test("the words do not repeat the definition the panel shows", () => {
    expect(
      withoutDefinition(
        [
          "Chlorophyll, the green substance in plant cells, absorbs light energy.",
          "This powers photosynthesis.",
        ],
        "chlorophyll",
        "The green substance in plant cells that absorbs light energy for photosynthesis.",
      ),
    ).toEqual(["Chlorophyll absorbs light energy.", "This powers photosynthesis."]);
  });

  test("a teaching slide takes no tag but keeps the counter; a stored TEACH tag goes on restyle", () => {
    const t = getTheme("chalk");
    const s = materialiseSlide(
      {
        kind: "content",
        factRefs: [],
        heading: "Erosion",
        body: "Waves wear cliffs away. Abrasion scrapes the rock.",
      },
      "chalk",
      meta,
    );
    expect(named(s.elements, KIND_TAG_NAME)).toHaveLength(0);
    expect(named(s.elements, "Heading")[0]?.y).toBe(SAFE.y);
    const [out] = withDeckChrome([s], t);
    const counter = named(out?.elements ?? [], COUNTER_NAME)[0];
    expect(counter?.y).toBe(SAFE.y);
    expect((counter?.x ?? 0) + (counter?.w ?? 0)).toBe(SAFE.x + SAFE.w);
    const head = named(s.elements, "Heading")[0];
    expect((head?.x ?? 0) + (head?.w ?? 0)).toBeLessThanOrEqual(counter?.x ?? 0);
    // A slide stored with the old tag: the heading under it, the words under that.
    const heading = named(s.elements, "Heading")[0] as SlideElement;
    const drop = 34;
    const stored: Slide = {
      ...s,
      elements: [
        ...s.elements.map((e) => (e.y >= heading.y ? { ...e, y: e.y + drop } : e)),
        {
          id: "old-tag",
          type: "text",
          x: SAFE.x,
          y: SAFE.y,
          w: 95,
          h: 28,
          name: KIND_TAG_NAME,
          doc: { type: "doc", content: [] },
          style: { preset: "caption" },
        },
      ],
    };
    const restyled = applyLook(stripLook(stored), t);
    expect(named(restyled.elements, KIND_TAG_NAME)).toHaveLength(0);
    const h = named(restyled.elements, "Heading")[0];
    expect(h?.y).toBe(SAFE.y);
    // The words rose with it: the same gap under the heading as a fresh slide has.
    const firstBody = (x: Slide) =>
      Math.min(
        ...x.elements.filter((e) => e.type === "text" && e.style.preset === "body").map((e) => e.y),
      );
    expect(firstBody(restyled)).toBe(firstBody(s));
  });

  test("with the deck known, a generated slide carries the counter and no year and subject line", () => {
    const s = materialiseSlide(
      { kind: "content", factRefs: [], heading: "Erosion", body: "Waves wear cliffs. Rock falls." },
      "chalk",
      meta,
      undefined,
      0,
      { deck: { yearGroup: "Year 9", subject: "Geography" } },
    );
    expect(named(s.elements, EYEBROW_NAME)).toHaveLength(0);
    // Untagged, the counter still sits at the top right (the heading leaves it the corner).
    expect(named(s.elements, COUNTER_NAME)).toHaveLength(1);
  });
});
