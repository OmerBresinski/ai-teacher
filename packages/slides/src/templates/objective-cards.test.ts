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

  test("off by default: the objectives stay the numbered list and a figure is not drawn", () => {
    for (const theme of THEMES) {
      const els = layoutTemplate({ ...objectives(3), figure: flow }, theme, "ks2").slide
        .elements as El[];
      expect(els.some((e) => e.name === "Objective card" || e.name === "Diagram")).toBe(false);
    }
  });
});
