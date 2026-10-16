import { describe, expect, test } from "bun:test";
import { resolveTextStyle } from "../text-style";
import { atKeyStage, MIN_FONT_SIZE, THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateId, type TemplateInput } from "./index";
import { templateSamples } from "./samples";

/*
 * TEACH-110 part a, row 1: every writer template lays out on every theme at KS1, KS2 and KS3 with
 * nothing over, every diagram drawn, and no text under master's reading floor (MIN_FONT_SIZE.body,
 * ruling 140). Then a never-throw corpus: odd writer output still gives a slide.
 */
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
const ALL: TemplateId[] = [
  "title",
  "objectives",
  "explain",
  "picture-text",
  "diagram-text",
  "big-diagram",
  "big-picture",
  "picture-sequence",
  "compare",
  "steps",
  "hinge",
  "question-set",
  "discussion",
  "practice",
  "exit-ticket",
  "equation-hero",
  "panel-list",
  "split-compare",
  "items-row",
  // TEACH-17 part b (C1).
  "worked",
  // TEACH-75 part ac (C4).
  "stages",
  // TEACH-239 part b (C7).
  "figure",
  // TEACH-75 part ab (C2).
  "source",
];

type Sized = {
  type: string;
  name?: string;
  style?: { fontSize?: number };
  textStyle?: { fontSize?: number };
  fontSize?: number;
  children?: Sized[];
};

const sizes = (els: readonly unknown[]): { name: string; size: number }[] =>
  (els as Sized[]).flatMap((e) => [
    ...[e.style?.fontSize, e.textStyle?.fontSize, e.type === "table" ? e.fontSize : undefined]
      .filter((s): s is number => s !== undefined)
      .map((size) => ({ name: e.name ?? e.type, size })),
    ...sizes(e.children ?? []),
  ]);

describe("every writer template on every theme", () => {
  test("the samples cover all 17 templates and there are 9 themes", () => {
    expect(templateSamples().map((s) => s.template)).toEqual(ALL);
    expect(THEMES).toHaveLength(10);
  });

  for (const theme of THEMES)
    for (const stage of STAGES)
      test(`${theme.id} ${stage}: no fit faults, every diagram drawn, text at or over the floor`, () => {
        const faults: string[] = [];
        for (const input of templateSamples(() => "x")) {
          const r = layoutTemplate(input, theme, stage);
          for (const o of r.over) faults.push(`${input.template} over: ${o}`);
          for (const d of r.diagram ?? []) faults.push(`${input.template} diagram: ${d}`);
          if (!r.slide.elements.length) faults.push(`${input.template}: empty slide`);
          for (const { name, size } of sizes(r.slide.elements))
            if (size < MIN_FONT_SIZE.body) faults.push(`${input.template} ${name} ${size}`);
        }
        expect(faults).toEqual([]);
      });

  test("a list marker is stored at the size every renderer draws, and its disc holds it", () => {
    let markers = 0;
    for (const theme of THEMES)
      for (const stage of STAGES)
        for (const input of templateSamples())
          for (const e of layoutTemplate(input, theme, stage).slide.elements)
            if (e.name === "Marker" && e.type === "shape") {
              const stored = e.textStyle?.fontSize ?? 0;
              const style = { preset: "body" as const, ...e.textStyle };
              expect(stored).toBeGreaterThanOrEqual(MIN_FONT_SIZE.body);
              // As master draws it today (no stage) and as part b will (the lesson's stage).
              expect(resolveTextStyle(style, theme, "body").fontSize).toBe(stored);
              expect(resolveTextStyle(style, atKeyStage(theme, stage), "body").fontSize).toBe(
                stored,
              );
              // The glyph line (1.2 em) sits inside the disc.
              expect(stored * 1.2).toBeLessThanOrEqual(e.h);
              markers++;
            }
    expect(markers).toBeGreaterThan(0);
  });
});

const long = (n: number) => "word ".repeat(n).trim();
const ODD: TemplateInput[] = ALL.flatMap((template): TemplateInput[] => [
  { template, heading: "" },
  {
    template,
    heading: long(60),
    lead: long(120),
    points: Array.from({ length: 12 }, (_, i) => (i % 2 ? long(40) : { label: long(8), text: "" })),
    questions: Array.from({ length: 12 }, () => long(30)),
    stem: long(80),
    options: Array.from({ length: 8 }, () => long(20)),
    columns: Array.from({ length: 5 }, () => ({
      label: long(6),
      text: long(50),
      figure: { photo: "" },
    })),
    sequence: Array.from({ length: 7 }, () => ({ caption: long(10), figure: { photo: "x" } })),
    instruction: long(40),
    formula: long(30),
    figure: { diagram: { kind: "no-such-kind" } },
  },
  {
    template,
    heading: "Supercalifragilisticexpialidocious-antidisestablishmentarianism",
    points: [],
    questions: [],
    options: [],
    columns: [],
    sequence: [],
    figure: { photo: "", aspect: 0 },
  },
  { template, heading: "Emoji 🐣 and RTL שלום", lead: "\n\n", figure: { diagram: null } },
]);

describe("never throws", () => {
  for (const stage of ["ks1", "ks3", "ks5"] as Stage[])
    test(`odd writer output at ${stage} still gives a slide on every theme`, () => {
      for (const theme of THEMES)
        for (const input of ODD) {
          const r = layoutTemplate(input, theme, stage);
          expect(Array.isArray(r.slide.elements)).toBe(true);
          expect(Array.isArray(r.over)).toBe(true);
        }
    });
});

// TEACH-75 part af (C8): a step with its library model, on every theme and stage.
describe("steps with a model on every theme", () => {
  const svg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" class="slide tk theme-primary" viewBox="0 0 990 450"><g><rect width="90" height="90"/><text x="9" y="40">Sand</text></g></svg>',
  )}`;
  const input: TemplateInput = {
    template: "steps",
    heading: "Filter",
    step: { n: 2, do: "Pour the mixture through filter paper.", see: "Water drips through." },
    figure: { drawn: { src: svg, aspect: 2.2, bare: true } },
  };
  for (const stage of ["ks1", "ks2", "ks3"] as Stage[])
    test(`${stage}: nothing over, every stored size its role's at the stage, none under the floor`, () => {
      for (const theme of THEMES) {
        const r = layoutTemplate(input, theme, stage);
        expect(r.over).toEqual([]);
        for (const e of r.slide.elements as {
          type: string;
          style?: { fontSize?: number; preset?: "body" | "heading" | "small" };
        }[]) {
          const size = e.style?.fontSize;
          if (e.type !== "text" || size === undefined) continue;
          expect(size).toBeGreaterThanOrEqual(MIN_FONT_SIZE.body);
          const style = { ...e.style, preset: e.style?.preset ?? ("body" as const) };
          expect(resolveTextStyle(style as never, atKeyStage(theme, stage), "body").fontSize).toBe(
            size,
          );
        }
      }
    });
});
