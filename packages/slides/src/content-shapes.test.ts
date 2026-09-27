import { describe, expect, test } from "bun:test";
import type { Theme } from "@tj/domain/documents";
import { CALLOUT_NAMES } from "./callout";
import {
  CALLOUT_BUDGETS,
  CALLOUT_TEXT_WORDS,
  COMPOSITION_BUDGETS,
  CONTENT_BUDGETS,
  CONTENT_SHAPES,
  type ContentShape,
  type ShapeComposition,
  shapeOf,
} from "./content-shapes";
import { type Counts, check, leadLinesFor, measure } from "./content-shapes.measure";
import { fitSlide } from "./fit-slide";
import { SAFE } from "./grid";
import { PHOTO_NAME } from "./look";
import { materialiseSlide, materialiseSlides } from "./materialise";
import { KEY_CARD_NAME } from "./structure";
import { THEMES } from "./themes";

/*
 * The budgets in `content-shapes.ts`, checked against the fit code: each shape and composition is
 * rendered at its budget through `materialiseSlide` (the full-measure explain through the look and
 * the fit directly, the path a slide takes when no panel is placed) with the filler below, and
 * must come out on one slide, at the body size, in the composition it was measured for. The
 * measured maximum is found again here, so a CSS or font change that moves it either way by more
 * than the rounding breaks the test: re-measure and update the numbers.
 */

const SLOT: Record<ContentShape, "body" | "points" | "sidePoints" | "steps"> = {
  explain: "body",
  list: "points",
  compare: "sidePoints",
  sequence: "steps",
};

describe("content budgets are what the renderer fits", () => {
  for (const shape of CONTENT_SHAPES) {
    for (const composition of Object.keys(COMPOSITION_BUDGETS[shape]) as ShapeComposition[]) {
      const budget = COMPOSITION_BUDGETS[shape][composition];
      if (!budget) continue;
      test(`${shape}, ${composition}: the budget fits on every theme, and is the measure rounded down`, () => {
        const counts = {
          heading: budget.heading.max,
          lead: budget.lead.max,
          slot: budget[SLOT[shape]]?.max ?? 0,
          ...(budget.side ? { side: budget.side.max } : {}),
        };
        const measured = THEMES.map((t) => measure(shape, composition, t));
        if (process.env.PRINT_BUDGETS) {
          console.log(
            shape,
            composition,
            JSON.stringify(measured.map((m, i) => [THEMES[i]?.id, m])),
          );
        }
        for (const t of THEMES) {
          expect(
            check(shape, composition, counts, t, leadLinesFor(composition)),
            `${t.id} at the budget`,
          ).not.toBeTypeOf("string");
        }
        const least = (k: keyof Counts) => Math.min(...measured.map((m) => m[k] ?? 0));
        // Rounded down for safety, but not so far that a change in the fonts would go unnoticed.
        for (const [k, max] of Object.entries(counts) as [keyof Counts, number][]) {
          expect(max, `${k} within the measure`).toBeLessThanOrEqual(least(k));
          expect(max, `${k} not far under the measure`).toBeGreaterThanOrEqual(
            Math.floor(least(k) * 0.75),
          );
        }
      });
    }
  }

  test("CONTENT_BUDGETS is the composition the writer gets", () => {
    expect(CONTENT_BUDGETS.explain).toEqual(COMPOSITION_BUDGETS.explain.full as never);
    expect(CONTENT_BUDGETS.list).toEqual(COMPOSITION_BUDGETS.list.full as never);
  });

  test("a spec's fields name its shape", () => {
    expect(shapeOf({})).toBe("explain");
    expect(shapeOf({ points: ["a", "b"] })).toBe("list");
    expect(shapeOf({ steps: ["a", "b"], points: ["a", "b"] })).toBe("sequence");
    expect(shapeOf({ compare: {}, steps: ["a", "b"] })).toBe("compare");
  });
});

describe("an explain slide whose body is one sentence", () => {
  const meta = { promptVersion: "t", model: "m", at: "2026-09-26T00:00:00.000Z" };
  const lone = {
    kind: "content" as const,
    factRefs: [],
    heading: "Why leaves are green",
    body: "Chlorophyll in the leaf reflects green light and absorbs the red and blue light.",
  };
  for (const t of THEMES) {
    test(`${t.id}: it is set as the key idea across the measure, not a line on an empty slide`, () => {
      const slide = materialiseSlide(lone, t.id, meta);
      const card = slide.elements.find((e) => e.name === KEY_CARD_NAME);
      expect(card).toBeDefined();
      expect(card?.w).toBe(SAFE.w);
      const words = JSON.stringify(slide.elements);
      expect(words).toContain("Key idea");
      expect(words.split("Chlorophyll in the leaf").length - 1).toBe(1);
      expect(fitSlide(slide, t).overflow).toEqual([]);
    });
  }
});

describe("CALLOUT_BUDGETS: an explain keeps a one-line callout under its words", () => {
  const meta = { model: "m", promptVersion: "p", generatedAt: new Date(0).toISOString() } as never;
  const W =
    "Plants take in carbon dioxide through small pores in their leaves and water from the soil through their roots while light energy absorbed by chlorophyll drives the reaction that makes glucose and releases oxygen into the surrounding air".split(
      " ",
    );
  const sentence = (n: number, from = 0) => {
    const w = Array.from({ length: n }, (_, i) => W[(from + i) % W.length]).join(" ");
    return `${w.charAt(0).toUpperCase()}${w.slice(1)}.`;
  };
  // One line for pupils, as generate-slide asks: 55 characters.
  const callout = { kind: "watch-out" as const, text: sentence(CALLOUT_TEXT_WORDS, 3) };
  const keeps = (t: Theme, lead: number, body: number, photo: boolean) => {
    const pages = materialiseSlides(
      {
        kind: "content",
        heading: "Water cycle",
        body: `${sentence(lead)} ${sentence(body, 7)}`,
        callout,
        factRefs: [],
      },
      t.id,
      meta,
      undefined,
      undefined,
      photo ? { photo: { subject: "A photograph" } } : {},
    );
    return (
      pages.length === 1 &&
      pages[0]?.elements.some((e) => e.name === CALLOUT_NAMES.card) === true &&
      (!photo || pages[0]?.elements.some((e) => e.name === PHOTO_NAME) === true)
    );
  };
  const capacity = (t: Theme, lead: number, photo: boolean) => {
    let n = 1;
    while (n <= 60 && keeps(t, lead, n, photo)) n += 1;
    return n - 1;
  };
  for (const [composition, photo] of [
    ["full", false],
    ["panel", true],
  ] as const) {
    test(`${composition}: the budget keeps the card on every theme, and is the least measure`, () => {
      const budget = CALLOUT_BUDGETS.explain[composition];
      const measured = THEMES.map((t) => capacity(t, budget.lead.max, photo));
      expect(Math.min(...measured)).toBe(budget.body?.max as number);
    });
  }

  const listKeeps = (t: Theme, points: number, words: number) => {
    const pages = materialiseSlides(
      {
        kind: "content",
        heading: "Water cycle",
        body: sentence(CALLOUT_BUDGETS.list.full.lead.max),
        points: Array.from({ length: points }, (_, i) => sentence(words, 5 + i * 11)),
        callout,
        factRefs: [],
      },
      t.id,
      meta,
    );
    return (
      pages.length === 1 && pages[0]?.elements.some((e) => e.name === CALLOUT_NAMES.card) === true
    );
  };

  test("list, full: two points at the budget keep the card on every theme; a third loses it", () => {
    const points = CALLOUT_BUDGETS.list.full.points;
    const [, most] = points?.count ?? [2, 2];
    const words = points?.max as number;
    for (const t of THEMES) expect(listKeeps(t, most, words), `${t.id} at the budget`).toBe(true);
    expect(THEMES.every((t) => listKeeps(t, most + 1, words))).toBe(false);
  });
});

describe("a list beside a photograph", () => {
  // Real teaching words, not the filler: the filler's even word lengths fit three points where
  // real ones wrap to a third line (PR 2 smoke, rivers and Romans).
  const meta = { model: "m", promptVersion: "p", generatedAt: new Date(0).toISOString() } as never;
  const lead = "Rainfall and land shape can combine to raise flood risk in valleys.";
  const real = [
    "Rainfall: Prolonged rain may exceed absorption, sending more runoff into rivers.",
    "Relief: Steep slopes speed runoff, leaving rivers less time to carry it away.",
    "Together: Prolonged rain on steep slopes can send water into rivers quickly.",
  ];
  const pages = (t: Theme, points: string[]) =>
    materialiseSlides(
      { kind: "content", heading: "Rainfall and relief", body: lead, points, factRefs: [] },
      t.id,
      meta,
      undefined,
      undefined,
      { photo: { subject: "A photograph" } },
    ).length;
  test("the budget's two points stay on the photo page; a third goes to a continuation", () => {
    const budget = COMPOSITION_BUDGETS.list.panel;
    expect(budget?.points?.count).toEqual([2, 2]);
    for (const t of THEMES) {
      expect(pages(t, real.slice(0, 2)), `${t.id} with two points`).toBe(1);
      expect(pages(t, real), `${t.id} with three points`).toBe(2);
    }
  });
});
