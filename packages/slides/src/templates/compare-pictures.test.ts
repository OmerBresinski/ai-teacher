import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import catalogue from "./catalogue.json";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";

/*
 * UX ruling 203, P10 (TEACH-75 part h): two picture cards hold at least as many words as three
 * (the 4:3 band at a wide card's width left 5 words at KS2 against 13 for three), and each card's
 * label is its own bold caps line, as Chalkie's picture cards are.
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
  test("two columns hold at least what three do, at every key stage", () => {
    for (const ks of ["KS1", "KS2", "KS3-5"])
      expect(cell(ks, "2 columns with pictures")).toBeGreaterThanOrEqual(
        cell(ks, "3 columns with pictures"),
      );
  });

  test("2 and 3 picture cards fit on every theme at KS2 with 11-word bodies", () => {
    for (const theme of THEMES)
      for (const n of [2, 3]) {
        const r = layoutTemplate(cards(n), theme, "ks2" as Stage);
        expect({ theme: theme.id, n, over: r.over }).toEqual({ theme: theme.id, n, over: [] });
      }
  });

  test("each picture card's label is its own bold caps line", () => {
    const els = layoutTemplate(cards(2), THEMES[0] as (typeof THEMES)[number], "ks2").slide
      .elements as { name?: string; doc?: unknown; style?: { fontWeight?: number } }[];
    const labels = els.filter((e) => e.name === "Label");
    expect(labels.map((e) => JSON.stringify(e.doc).match(/"text":"([^"]*)"/)?.[1])).toEqual([
      "LAMB",
      "CALF",
    ]);
    for (const l of labels) expect(l.style?.fontWeight).toBe(700);
  });

  test("text cards (no pictures) are unchanged: labels as written", () => {
    const input = { ...cards(2), columns: cards(2).columns?.map(({ figure: _f, ...c }) => c) };
    const els = layoutTemplate(input, THEMES[0] as (typeof THEMES)[number], "ks2").slide
      .elements as { name?: string; doc?: unknown }[];
    expect(JSON.stringify(els.find((e) => e.name === "Label")?.doc)).toContain('"Lamb"');
  });
});
