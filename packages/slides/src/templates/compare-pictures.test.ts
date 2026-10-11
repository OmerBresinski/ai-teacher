import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import catalogue from "./catalogue.json";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";

const on = (...a: Parameters<typeof layoutTemplate>) =>
  layoutTemplate(a[0], a[1], a[2], { ...a[3], pictureBand: true });

/*
 * UX ruling 203, P10 (TEACH-75 part h): two picture cards hold at least as many words as three
 * (the 4:3 band at a wide card's width left 5 words at KS2 against 13 for three), and each card's
 * label is its own bold caps line.
 */
type Cap = {
  templates: {
    id: string;
    capacity: Record<string, { variants: { label: string; maxCharsPerItem: number }[] }>;
  }[];
};
const cell = (ks: string, label: string) =>
  (catalogue as Cap).templates
    .find((t) => t.id === "compare")
    ?.capacity[ks]?.variants.find((v) => v.label === label)?.maxCharsPerItem ?? 0;

const photo = { photo: "", aspect: 4 / 3, alt: "x" };
const words = "Young lambs drink their mother's milk and stay close to her in the field";
const cards = (n: number): TemplateInput => ({
  template: "compare",
  heading: "Lambs and calves",
  columns: Array.from({ length: n }, (_, k) => ({
    label: ["Lamb", "Calf", "Foal", "Kid"][k] as string,
    text: words.slice(0, 66),
    figure: photo,
  })),
});

describe("compare with pictures", () => {
  test("with the option, two columns hold at least what three do; off, the writer's budget is the render's", () => {
    // The longest body (in characters) a card takes at full size with nothing over.
    const most = (
      n: number,
      band: boolean,
      stage: Stage,
      theme = THEMES[3] as (typeof THEMES)[number],
    ) => {
      let lo = 0;
      let hi = 400;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const input = {
          ...cards(n),
          columns: cards(n).columns?.map((c) => ({
            ...c,
            text: "word ".repeat(80).slice(0, mid).trim(),
          })),
        };
        const r = layoutTemplate(input, theme, stage, {
          fullSize: true,
          ...(band ? { pictureBand: true } : {}),
        });
        if (r.over.length) hi = mid - 1;
        else lo = mid;
      }
      return lo;
    };
    for (const [ks, stage] of [
      ["KS1", "ks1"],
      ["KS2", "ks2"],
      ["KS3-5", "ks3"],
    ] as const) {
      expect({ ks, ok: most(2, true, stage) >= most(3, true, stage) }).toEqual({ ks, ok: true });
      // Off (the default), two cards still hold less than three: the catalogue's budget, which the
      // writer's fit table and prompt use, is unchanged and matches this render.
      expect(most(2, false, stage)).toBeLessThan(most(3, false, stage));
      expect(cell(ks, "2 columns with pictures")).toBeLessThan(cell(ks, "3 columns with pictures"));
    }
  });

  test("2 and 3 picture cards fit on every theme at KS2 with 11-word bodies", () => {
    for (const theme of THEMES)
      for (const n of [2, 3]) {
        const r = on(cards(n), theme, "ks2" as Stage);
        expect({ theme: theme.id, n, over: r.over }).toEqual({ theme: theme.id, n, over: [] });
      }
  });

  test("each picture card's label is its own bold caps line", () => {
    const els = on(cards(2), THEMES[0] as (typeof THEMES)[number], "ks2").slide.elements as {
      name?: string;
      doc?: unknown;
      style?: { fontWeight?: number };
    }[];
    const labels = els.filter((e) => e.name === "Label");
    expect(labels.map((e) => JSON.stringify(e.doc).match(/"text":"([^"]*)"/)?.[1])).toEqual([
      "LAMB",
      "CALF",
    ]);
    for (const l of labels) expect(l.style?.fontWeight).toBe(700);
  });

  test("text cards (no pictures) are unchanged: labels as written", () => {
    const input = { ...cards(2), columns: cards(2).columns?.map(({ figure: _f, ...c }) => c) };
    const els = on(input, THEMES[0] as (typeof THEMES)[number], "ks2").slide.elements as {
      name?: string;
      doc?: unknown;
    }[];
    expect(JSON.stringify(els.find((e) => e.name === "Label")?.doc)).toContain('"Lamb"');
  });

  test("off by default: labels as written", () => {
    const els = layoutTemplate(cards(2), THEMES[0] as (typeof THEMES)[number], "ks2").slide
      .elements as { name?: string; doc?: unknown }[];
    expect(JSON.stringify(els.find((e) => e.name === "Label")?.doc)).toContain('"Lamb"');
  });
});
