import { describe, expect, test } from "bun:test";
import type { Theme } from "@tj/domain/documents";
import { CALLOUT_MEASURE_TEXT, CALLOUT_NAMES } from "./callout";
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

describe("CALLOUT_BUDGETS: real words keep a one-line callout under them", () => {
  // Real bodies, points and a 60-character callout from the PR 2 smoke runs (4, 5), not the
  // filler: the filler's even word lengths gave one word too many beside a photograph and on a
  // list (a 58-character card under a 21-word body still dropped). Each budget is the least
  // measure over the six themes less one word, so a writer one word over still keeps the card.
  const meta = { model: "m", promptVersion: "p", generatedAt: new Date(0).toISOString() } as never;
  const PROSE =
    "Fewer trees catch rain or take up water. In the Amazon Basin, cleared land can send more water overground into rivers, raising flood risk. Hard surfaces limit soaking, sending rain through drains to rivers. Birmingham's built-up streets show how this raises river levels faster. Magic lets Prospero direct where people go, controlling later meetings.".split(
      " ",
    );
  const prose = (n: number) =>
    `${PROSE.slice(0, n)
      .join(" ")
      .replace(/[.,;]$/, "")}.`;
  const LEAD = "These measures manage water to lower flood risk, but cannot eliminate it."; // 12 words
  const LIST_LEAD = "Three measures can lower flood risk in towns along rivers."; // 10 words
  const POINTS = [
    "Embankments: Raised banks keep water in channels, reducing nearby flood risk.",
    "Storage areas: Hold excess water so rivers do not overflow into towns.",
    "Public baths: At Aquae Sulis, baths offered shared washing and meeting.",
  ];
  const words = (text: string, n: number) => text.split(" ").slice(0, n).join(" ");
  const callout = { kind: "watch-out" as const, text: CALLOUT_MEASURE_TEXT };
  const keeps = (t: Theme, spec: Record<string, unknown>, photo = false) => {
    const pages = materialiseSlides(
      { kind: "content", heading: "Reducing flood risk", factRefs: [], callout, ...spec } as never,
      t.id,
      meta,
      undefined,
      undefined,
      { ...(photo ? { photo: { subject: "A photograph" } } : {}), sidePanel: false },
    );
    return (
      pages.length === 1 &&
      pages[0]?.elements.some((e) => e.name === CALLOUT_NAMES.card) === true &&
      (!photo || pages[0]?.elements.some((e) => e.name === PHOTO_NAME) === true)
    );
  };
  const least = (f: (t: Theme, n: number) => boolean, from = 1) =>
    Math.min(
      ...THEMES.map((t) => {
        let n = from;
        while (n <= 60 && f(t, n)) n += 1;
        return n - 1;
      }),
    );

  test("the callout text is one line of about 60 characters", () => {
    expect(callout.text.split(" ").length).toBeLessThanOrEqual(CALLOUT_TEXT_WORDS);
  });

  for (const [composition, photo] of [
    ["full", false],
    ["panel", true],
  ] as const) {
    test(`explain, ${composition}: the budget is the least real measure less one word`, () => {
      const budget = CALLOUT_BUDGETS.explain[composition];
      expect(budget.lead.max).toBe(12);
      const measured = least((t, n) => keeps(t, { body: `${LEAD} ${prose(n)}` }, photo));
      expect(budget.body?.max).toBe(measured - 1);
    });
  }

  test("list, full: two points at the budget keep the card on every theme; a third loses it", () => {
    const budget = CALLOUT_BUDGETS.list.full;
    expect(budget.lead.max).toBe(10);
    const measured = least(
      (t, n) => keeps(t, { body: LIST_LEAD, points: POINTS.slice(0, 2).map((p) => words(p, n)) }),
      3,
    );
    expect(budget.points?.max).toBe(measured - 1);
    const at = budget.points?.max as number;
    const three = { body: LIST_LEAD, points: POINTS.map((p) => words(p, at)) };
    expect(THEMES.every((t) => keeps(t, three))).toBe(false);
  });

  test("no room beside a photograph for a list, nor under a compare or a sequence", () => {
    // Two 4-word points beside a photograph, a compare of 4-word points, three 5-word steps: short
    // of any budget, and the card still does not fit on every theme. The planner gives these
    // slides a callout or a photo, never both (`outline-from-facts`).
    const four = POINTS.map((p) => words(p, 4));
    expect(THEMES.every((t) => keeps(t, { body: LIST_LEAD, points: four.slice(0, 2) }, true))).toBe(
      false,
    );
    const compare = {
      body: "Two ways to manage floods.",
      compare: {
        left: { label: "Hard", points: [four[0], four[1]] },
        right: { label: "Soft", points: [four[2], four[1]] },
      },
    };
    expect(THEMES.every((t) => keeps(t, compare))).toBe(false);
    const steps = { body: "How rain reaches a river.", steps: POINTS.map((p) => words(p, 5)) };
    expect(THEMES.every((t) => keeps(t, steps))).toBe(false);
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
