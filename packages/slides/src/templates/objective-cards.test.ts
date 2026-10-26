import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import catalogue from "./catalogue.json";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";

const on = (...a: Parameters<typeof layoutTemplate>) =>
  layoutTemplate(a[0], a[1], a[2], { ...a[3], objectiveCards: true });

/*
 * UX ruling 203, P12 (TEACH-75 part i): the objectives slide is numbered disc cards, with a
 * figure beside them when one is given; what the cards cannot hold is the numbered list as
 * before, so the measured objectives capacity never drops.
 */
type El = { name?: string; stroke?: string; doc?: unknown };
const objectives = (n: number, words = 9): TemplateInput => ({
  template: "objectives",
  heading: "Today we are learning to",
  points: Array.from({ length: n }, (_, k) =>
    `${k + 1} ${"name describe explain the parts of the heart and blood ".repeat(3)}`
      .split(" ")
      .slice(0, words)
      .join(" "),
  ),
});
const flow = {
  diagram: {
    kind: "flow",
    alt: "loop",
    steps: [{ label: "Lungs" }, { label: "Heart" }, { label: "Body" }],
  },
};

describe("objectives as numbered disc cards", () => {
  test("2, 3 and 4 objectives are cards on every theme at every stage, nothing over", () => {
    for (const stage of ["ks1", "ks2", "ks3"] as Stage[])
      for (const theme of THEMES)
        for (const n of [2, 3, 4]) {
          const r = on(objectives(n), theme, stage);
          const els = r.slide.elements as El[];
          expect({ stage, theme: theme.id, n, over: r.over }).toEqual({
            stage,
            theme: theme.id,
            n,
            over: [],
          });
          const cards = els.filter((e) => e.name === "Objective card");
          expect({ stage, theme: theme.id, n, cards: cards.length }).toEqual({
            stage,
            theme: theme.id,
            n,
            cards: n,
          });
          for (const c of cards) expect(c.stroke).toBe(theme.colors.accent);
          expect(els.filter((e) => e.name === "Marker")).toHaveLength(n);
        }
  });

  test("with a figure the cards sit beside it", () => {
    for (const theme of THEMES) {
      const r = on({ ...objectives(3), figure: flow }, theme, "ks2");
      const els = r.slide.elements as El[];
      expect({ theme: theme.id, over: r.over }).toEqual({ theme: theme.id, over: [] });
      expect(els.some((e) => e.name === "Diagram")).toBe(true);
      expect(els.filter((e) => e.name === "Objective card")).toHaveLength(3);
    }
  });

  test("objectives at the measured capacity still fit (cards or the list)", () => {
    type Cap = {
      templates: {
        id: string;
        capacity: Record<string, { variants: { label: string; maxCharsPerItem: number }[] }>;
      }[];
    };
    const doc = (catalogue as Cap).templates.find((t) => t.id === "objectives");
    for (const [ks, stage, themeId] of [
      ["KS1", "ks1", "splash"],
      ["KS2", "ks2", "splash"],
      ["KS3-5", "ks3", "studio"],
    ] as const)
      for (const v of doc?.capacity[ks]?.variants ?? []) {
        const n = Number(v.label.match(/\d+/)?.[0] ?? 3);
        const item = "word ".repeat(60).slice(0, v.maxCharsPerItem).trim();
        const theme = THEMES.find((t) => t.id === themeId) as (typeof THEMES)[number];
        const r = on(
          {
            template: "objectives",
            heading: "Today",
            points: Array.from({ length: n }, () => item),
          },
          theme,
          stage,
        );
        expect({ ks, v: v.label, over: r.over }).toEqual({ ks, v: v.label, over: [] });
      }
  });

  test("the figure stays behind the option; the cards are on by default and take the full width", () => {
    for (const theme of THEMES) {
      const els = layoutTemplate({ ...objectives(3), figure: flow }, theme, "ks2").slide
        .elements as (El & { x?: number; w?: number })[];
      expect(els.some((e) => e.name === "Diagram")).toBe(false);
      const cards = els.filter((e) => e.name === "Objective card");
      expect(cards).toHaveLength(3);
      for (const c of cards) expect({ x: c.x, w: c.w }).toEqual({ x: 64, w: 832 });
    }
  });
});

/*
 * The objectives slide flows with the objectives' length (Greg, 25 Oct 2026, TEACH-110 part an):
 * one size for the slide from the longest objective, the largest step of the type scale that
 * holds; every card the tallest card's height; the stack centred in the band.
 */
type Laid = {
  name?: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style?: { fontSize?: number };
};
const lay = (points: string[], themeId = "crayon", stage: Stage = "ks1") => {
  const theme = THEMES.find((t) => t.id === themeId) as (typeof THEMES)[number];
  const r = layoutTemplate(
    { template: "objectives", heading: "Today we are learning to", points },
    theme,
    stage,
  );
  const els = r.slide.elements as Laid[];
  return {
    over: r.over,
    cards: els.filter((e) => e.name === "Objective card"),
    sizes: [...new Set(els.filter((e) => e.name === "Item").map((e) => e.style?.fontSize))],
  };
};
const TEACHER = [
  "Identify and name the roots, stem, leaves and flowers of a flowering plant.",
  "Describe how roots take in water and hold the plant in place, and how the stem holds it up and carries water.",
  "Describe how leaves use sunlight to help the plant make food and how flowers help the plant make seeds.",
];

describe("objectives flow with their length", () => {
  test("short objectives take a larger step than long ones; one size a slide", () => {
    const short = lay(["Name the parts of a plant.", "Say what roots do."]);
    const long = lay(TEACHER);
    expect(short.sizes).toHaveLength(1);
    expect(long.sizes).toHaveLength(1);
    expect(short.sizes[0] as number).toBeGreaterThan(long.sizes[0] as number);
    expect(long.over).toEqual([]);
  });

  test("cards share one height and centre in the band, on every theme", () => {
    for (const theme of THEMES)
      for (const n of [2, 3, 4]) {
        const r = lay(TEACHER.concat("Say what a plant needs.").slice(0, n), theme.id);
        const hs = new Set(r.cards.map((c) => c.h));
        expect({ theme: theme.id, n, heights: hs.size }).toEqual({
          theme: theme.id,
          n,
          heights: 1,
        });
        if (r.over.length) continue;
        const top = Math.min(...r.cards.map((c) => c.y));
        const bottom = Math.max(...r.cards.map((c) => c.y + c.h));
        // Centred in the space under the heading: the band's top (160) to the safe foot (497); a
        // heading that needs room moves the stack down a few points (`shiftBody`).
        expect({ theme: theme.id, n, inSpace: top >= 160 && bottom <= 497 }).toEqual({
          theme: theme.id,
          n,
          inSpace: true,
        });
        expect(Math.abs((top + bottom) / 2 - (160 + 497) / 2)).toBeLessThanOrEqual(12);
      }
  });

  test("four teacher-length objectives fit under bodySmall with tight cards, above the floor", () => {
    const r = lay(
      TEACHER.concat("Explain why a plant needs water, light and warmth to grow well."),
    );
    expect(r.over).toEqual([]);
    expect(r.sizes[0] as number).toBeGreaterThanOrEqual(22);
    expect(r.sizes[0] as number).toBeLessThan(28);
  });

  test("past the floor it still holds on the slide, reported so the writer shortens", () => {
    const long = `${TEACHER[1]} ${TEACHER[2]}`;
    const r = lay([long, long, long, long]);
    expect(r.over).toEqual(["objectives under the floor"]);
    expect(Math.max(...r.cards.map((c) => c.y + c.h))).toBeLessThanOrEqual(497);
  });

  test("4 long objectives may sit as a 2x2 grid once the stack would go under bodySmall", () => {
    const long = `${TEACHER[1]} ${TEACHER[2]}`;
    const r = lay([long, long, long, long]);
    const xs = new Set(r.cards.map((c) => c.x));
    expect(xs.size === 1 || xs.size === 2).toBe(true);
    expect(r.cards).toHaveLength(4);
  });
});
