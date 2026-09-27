import { describe, expect, test } from "bun:test";
import type { Slide, TextElement } from "@tj/domain/documents";
import { CONTENT_BUDGETS } from "./content-shapes";
import { fitSlide } from "./fit-slide";
import { SAFE } from "./grid";
import { COUNTER_NAME, DIAGRAM_NAME, EYEBROW_NAME, KIND_TAG_NAME } from "./look";
import { materialiseSlide, shapeFallback, withoutDiagramSlot, withShapeHints } from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import { isEditorialIssue, type SlideSpecOf, SPEC_LIMITS, slideSpecSchemaFor } from "./specs";
import {
  COMPARE_NAME,
  docLines,
  ITEM_NAME,
  KEY_CARD_NAME,
  LEAD_NAME,
  PANEL_NAME,
  STEP_NAME,
  stepsStrip,
} from "./structure";
import { measureHeadless } from "./text-measure";
import { floorBelow } from "./text-style";
import { getTheme, THEMES } from "./themes";

/*
 * look/shape-render: a content spec's explicit shape fields (`compare`, `steps`, `points`) placed
 * as their components, the word-budget spec check, and the fallback when a component cannot fit.
 */

const meta = { promptVersion: "t", model: "m", at: "2026-09-26T00:00:00.000Z" };
const plain = (e: unknown) => docLines((e as TextElement).doc).join(" ");
const named = (s: Slide, name: string) => s.elements.filter((e) => e.name === name);
const texts = (s: Slide) =>
  s.elements.filter((e): e is TextElement => e.type === "text").map((e) => plain(e));

type Content = SlideSpecOf<"content">;
const coasts: Content = {
  kind: "content",
  factRefs: [],
  heading: "Protecting the coast",
  body: "Councils protect coasts in two ways.",
  compare: {
    left: { label: "Hard engineering", points: ["Sea walls", "Costly to build"] },
    right: { label: "Soft engineering", points: ["Beach nourishment", "Cheaper to run"] },
  },
};
const cycle: Content = {
  kind: "content",
  factRefs: [],
  heading: "The water cycle",
  body: "Water moves in a loop.",
  steps: ["Evaporation", "Condensation", "Precipitation", "Collection"],
};

describe("explicit shape fields become the structure hints", () => {
  test("compare, steps and points map to their hints; a field wins over a caller's hint", () => {
    const keyCard = { label: "Key term", text: "x" };
    expect(withShapeHints(coasts, { keyCard, terms: ["sea"] })).toEqual({
      terms: ["sea"],
      compare: {
        left: { label: "Hard engineering", points: ["Sea walls", "Costly to build"] },
        right: { label: "Soft engineering", points: ["Beach nourishment", "Cheaper to run"] },
      },
    });
    expect(withShapeHints(cycle, { keyCard }).sequence).toEqual(cycle.steps ?? []);
    expect(withShapeHints(cycle, { keyCard }).keyCard).toBeUndefined();
    const list = { ...cycle, steps: undefined, points: ["a b", "c d"] };
    expect(withShapeHints(list).points).toEqual(["a b", "c d"]);
    // No field: the caller's hints stand, and inference stays the fallback.
    const bare = { ...cycle, steps: undefined };
    expect(withShapeHints(bare, { keyCard })).toEqual({ keyCard });
  });

  for (const t of THEMES) {
    test(`${t.id}: compare is two labelled cards under the lead`, () => {
      const slide = materialiseSlide(coasts, t.id, meta);
      const cards = named(slide, COMPARE_NAME);
      expect(cards).toHaveLength(2);
      const all = texts(slide);
      expect(all).toContain("Hard engineering");
      expect(all).toContain("Sea walls Costly to build");
      const lead = slide.elements.find(
        (e) => e.type === "text" && plain(e) === coasts.body,
      ) as TextElement;
      expect(lead.y).toBeLessThan(cards[0]?.y ?? 0);
      expect(fitSlide(slide, t).overflow).toEqual([]);
    });

    test(`${t.id}: steps are the steps strip under the lead`, () => {
      const slide = materialiseSlide(cycle, t.id, meta);
      expect(named(slide, STEP_NAME)).toHaveLength(4);
      expect([1, 2, 3, 4].map((n) => plain(named(slide, `Step ${n}`)[0]))).toEqual(
        cycle.steps ?? [],
      );
      expect(fitSlide(slide, t).overflow).toEqual([]);
    });
  }

  test("an explicit field wins over inference: a heading that names two kinds, a word equation", () => {
    // Inference alone would make these a compare of "Hard engineering"/"Soft engineering" …
    const inferredCompare: Content = {
      kind: "content",
      factRefs: [],
      heading: "Hard and soft engineering suit different coasts",
      body: "Hard engineering uses sea walls. Soft engineering adds sediment.",
      steps: ["Survey the coast", "Choose a scheme", "Build it"],
    };
    const a = materialiseSlide(inferredCompare, "chalk", meta);
    expect(named(a, COMPARE_NAME)).toHaveLength(0);
    expect(named(a, STEP_NAME)).toHaveLength(3);
    // … and a key card of the word equation.
    const equation: Content = {
      kind: "content",
      factRefs: [],
      heading: "Photosynthesis",
      body: "Plants make glucose: carbon dioxide + water → glucose + oxygen.",
      points: ["Needs light", "Happens in chloroplasts"],
    };
    const b = materialiseSlide(equation, "chalk", meta);
    expect(named(b, KEY_CARD_NAME)).toHaveLength(0);
    expect(named(b, PANEL_NAME)).toHaveLength(0);
    expect(plain(named(b, LEAD_NAME)[0])).toBe(equation.body);
    expect(named(b, ITEM_NAME).map(plain)).toEqual(["Needs light", "Happens in chloroplasts"]);
    // Without the field, inference still sets the equation on its card.
    const inferred = materialiseSlide({ ...equation, points: undefined }, "chalk", meta);
    expect(texts(inferred)).toContain("carbon dioxide + water → glucose + oxygen");
  });

  test("a written list with a key term keeps the full measure; the term is picked out in the words", () => {
    const slide = materialiseSlide(
      {
        kind: "content",
        factRefs: [],
        heading: "Limiting factors",
        body: "Three things limit photosynthesis.",
        points: ["Light intensity", "Carbon dioxide", "Temperature"],
      },
      "chalk",
      meta,
      undefined,
      0,
      {
        terms: ["photosynthesis"],
        glossary: [{ term: "photosynthesis", definition: "How plants make glucose." }],
      },
    );
    expect(named(slide, PANEL_NAME)).toHaveLength(0);
    expect(JSON.stringify(named(slide, LEAD_NAME))).toContain('"bold"');
    expect(plain(named(slide, LEAD_NAME)[0])).toBe("Three things limit photosynthesis.");
    expect(named(slide, ITEM_NAME)).toHaveLength(3);
  });

  test("a compare or a sequence takes the full measure: no diagram slot beside it", () => {
    const slide = materialiseSlide({ ...cycle, diagram: "The loop, clockwise" }, "chalk", meta);
    expect(named(slide, DIAGRAM_NAME)).toHaveLength(0);
    expect(named(slide, STEP_NAME)).toHaveLength(4);
  });
});

describe("a compare or steps that cannot fit reads as the lead plus points", () => {
  const long = (n: number) =>
    Array.from({ length: n }, (_, i) => `word${i} photosynthesis chlorophyll`).join(" ");
  for (const t of THEMES) {
    test(`${t.id}: compare too long for its cards`, () => {
      const spec: Content = {
        ...coasts,
        compare: {
          left: { label: "Hard", points: [long(6), long(6), long(6)] },
          right: { label: "Soft", points: [long(6), long(6), long(6)] },
        },
      };
      const slide = materialiseSlide(spec, t.id, meta);
      expect(named(slide, COMPARE_NAME)).toHaveLength(0);
      // Nothing of the spec is lost: each side is one point, its label first.
      const all = texts(slide).join(" ");
      expect(all).toContain(coasts.body);
      expect(all).toContain(`Hard: ${long(6)}; ${long(6)}`);
      expect(all).toContain(`Soft: ${long(6)}`);
      // Never below the body floor.
      for (const e of slide.elements) {
        if (e.type === "text" && e.style.preset === "body" && e.style.fontSize) {
          expect(e.style.fontSize).toBeGreaterThanOrEqual(floorBelow(t, "body"));
        }
      }
    });

    test(`${t.id}: steps too long for the strip`, () => {
      const steps = [long(4), long(4), long(4), long(4)];
      const slide = materialiseSlide({ ...cycle, steps }, t.id, meta);
      expect(named(slide, STEP_NAME)).toHaveLength(0);
      const all = texts(slide).join(" ");
      for (const s of steps) expect(all).toContain(s);
      for (const e of slide.elements) {
        if (e.type === "text" && e.style.preset === "body" && e.style.fontSize) {
          expect(e.style.fontSize).toBeGreaterThanOrEqual(floorBelow(t, "body"));
        }
      }
    });
  }
});

describe("a slot over its word budget is placed, not retried", () => {
  const schema = slideSpecSchemaFor("content");
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const issues = (spec: unknown) => {
    const got = schema?.safeParse(spec);
    return got?.success ? [] : (got?.error.issues ?? []);
  };

  test("steps of 7-11 words against a budget of 6 raise no issue, so no Repair pass", () => {
    const max = CONTENT_BUDGETS.sequence.steps?.max ?? 0;
    const steps = [words(max + 1), words(11), words(max * 2), words(8)];
    expect(issues({ ...cycle, steps })).toEqual([]);
    const side = CONTENT_BUDGETS.compare.sidePoints?.max ?? 0;
    const compare = {
      ...coasts,
      compare: { ...coasts.compare, right: { label: "Soft", points: ["a", words(side * 3)] } },
    };
    expect(issues(compare)).toEqual([]);
    expect(issues({ ...cycle, diagram: "The loop" })).toEqual([]);
  });

  test("past the hard limit (SPEC_LIMITS) the retry stands", () => {
    const long = "x".repeat(Math.ceil(SPEC_LIMITS.item * 1.5) + 1);
    const got = issues({ ...cycle, steps: ["a", long] });
    expect(got.map((i) => i.path)).toEqual([["steps", 1]]);
    expect(got.every(isEditorialIssue)).toBe(true);
  });

  test("shapeFallback names the shape a slide could not place as written", () => {
    const placed = materialiseSlide(cycle, "chalk", meta);
    expect(shapeFallback(cycle, placed)).toBeUndefined();
    const long = (n: number) =>
      Array.from({ length: n }, (_, i) => `word${i} photosynthesis chlorophyll`).join(" ");
    const tooLong = { ...cycle, steps: [long(4), long(4), long(4), long(4)] };
    expect(shapeFallback(tooLong, materialiseSlide(tooLong, "chalk", meta))).toBe("sequence");
    const cards = {
      ...coasts,
      compare: {
        left: { label: "Hard", points: [long(6), long(6), long(6)] },
        right: { label: "Soft", points: [long(6), long(6), long(6)] },
      },
    };
    expect(shapeFallback(cards, materialiseSlide(cards, "chalk", meta))).toBe("compare");
    const bare = { ...cycle, steps: undefined };
    expect(shapeFallback(bare, materialiseSlide(bare, "chalk", meta))).toBeUndefined();
  });
});

describe("a diagram instruction with no drawing, outside the editor", () => {
  const volcano: Content = {
    kind: "content",
    factRefs: [],
    heading: "How a volcano erupts",
    body: "Magma rises through cracks in the crust. Pressure builds as gas collects in the magma chamber. The crust gives way and lava pours out.",
    diagram: "Cross-section: magma chamber, vent, crater, ash cloud",
  };
  const halfway = SAFE.x + SAFE.w / 2;
  for (const t of THEMES) {
    test(`${t.id}: the words take the slide back, a key idea on the panel or across the measure`, () => {
      const stored = materialiseSlide(volcano, t.id, meta, undefined, 0, { terms: ["magma"] });
      expect(named(stored, DIAGRAM_NAME)).toHaveLength(1);
      const shown = withoutDiagramSlot(stored, t);
      expect(named(shown, DIAGRAM_NAME)).toHaveLength(0);
      // Nothing on the right half is empty: a panel stands there, or the words cross it.
      const right = shown.elements.filter((e) => e.x + e.w > halfway + 40 && e.y > 140);
      expect(right.length).toBeGreaterThan(0);
      // Every word stays.
      const all = texts(shown).join(" ");
      for (const s of volcano.body.split(". ")) expect(all).toContain(s.replace(/\.$/, ""));
      expect(fitSlide(shown, t).overflow).toEqual([]);
      // The key term keeps its mark; the top line and counter come back.
      expect(JSON.stringify(shown.elements)).toContain('"bold"');
    });
  }
  test("a slide without a slot is returned as it is", () => {
    const slide = materialiseSlide(cycle, "chalk", meta);
    expect(withoutDiagramSlot(slide, getTheme("chalk"))).toBe(slide);
  });
  test("the deck line and counter survive the relayout", () => {
    const stored = materialiseSlide(volcano, "chalk", meta, undefined, 0, {
      deck: { yearGroup: "Year 8", subject: "Geography" },
    });
    const shown = withoutDiagramSlot(stored, getTheme("chalk"));
    expect(named(stored, EYEBROW_NAME)).toHaveLength(1);
    expect(named(shown, EYEBROW_NAME)).toEqual(named(stored, EYEBROW_NAME));
    expect(named(shown, COUNTER_NAME)).toEqual(named(stored, COUNTER_NAME));
    expect(named(shown, KIND_TAG_NAME)).toEqual(named(stored, KIND_TAG_NAME));
  });
});

describe("the steps strip never breaks a word", () => {
  const cycleSteps = ["Evaporation", "Condensation", "Precipitation", "Collection"];
  for (const t of THEMES) {
    test(`${t.id}: long words take a tighter strip, one line each, or no strip`, () => {
      const strip = stepsStrip(cycleSteps, 200, SAFE_BOTTOM, t);
      if (!strip) return;
      const measure = measureHeadless(t);
      for (const n of [1, 2, 3, 4]) {
        const step = strip.elements.find((e) => e.name === `Step ${n}`) as TextElement;
        const size = step.style.fontSize ?? 0;
        const h = measure({
          doc: step.doc,
          width: step.w,
          style: step.style,
          preset: "small",
          inset: 0,
          chrome: 0,
        });
        expect(h).toBeLessThanOrEqual(size * t.lineHeights.small * 1.5);
      }
    });
  }
  test("a word no card can hold: no strip", () => {
    const steps = ["Pneumonoultramicroscopicsilicovolcanoconiosis", "b", "c", "d"];
    expect(stepsStrip(steps, 200, SAFE_BOTTOM, getTheme("chalk"))).toBeUndefined();
  });
});
