import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import { type Figure, layoutTemplate, type Stage, type TemplateInput } from "./index";
import { templateSamples } from "./samples";
import { compareWithDiagrams, hingeWithFigure, sequenceWithDiagrams } from "./tile-visual-samples";

/*
 * TEACH-75 part d: compare cards, sequence stages and a hinge take a diagram. Each fits on every
 * theme at KS1 to KS3 with every drawing shown; a tile diagram that cannot draw is reported in
 * `lost` (the caller retries it as a picture) and the slide is laid words-only, never with an empty
 * band or panel.
 */
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
const drawn = (r: ReturnType<typeof layoutTemplate>) =>
  r.slide.elements.filter((e) => e.name === "Diagram").length;

describe("tile visuals fit on every theme", () => {
  const cases: [string, TemplateInput, number][] = [
    ["compare 2", compareWithDiagrams(2), 2],
    ["compare 3 (three vessels)", compareWithDiagrams(3), 3],
    ["compare 4", compareWithDiagrams(4), 4],
    ["sequence 2", sequenceWithDiagrams(2), 2],
    ["sequence 3", sequenceWithDiagrams(3), 3],
    ["sequence 4", sequenceWithDiagrams(4), 4],
    ["hinge with a figure", hingeWithFigure(), 1],
    ["hinge with a figure, 2 options", hingeWithFigure(2), 1],
  ];
  for (const [name, input, n] of cases)
    test(`${name}: every drawing shown, nothing over, nothing lost`, () => {
      const faults: string[] = [];
      for (const theme of THEMES)
        for (const stage of STAGES) {
          const r = layoutTemplate(input, theme, stage);
          const at = `${theme.id} ${stage}`;
          for (const o of r.over) faults.push(`${at} over: ${o}`);
          for (const d of r.diagram ?? []) faults.push(`${at} diagram: ${d}`);
          if (r.lost) faults.push(`${at} lost ${r.lost}`);
          if (drawn(r) !== n) faults.push(`${at} drew ${drawn(r)} of ${n}`);
        }
      expect(faults).toEqual([]);
    });

  test("a hinge with a figure keeps its options left of the drawing", () => {
    for (const theme of THEMES) {
      const els = layoutTemplate(hingeWithFigure(), theme, "ks2").slide.elements;
      const fig = els.find((e) => e.name === "Diagram");
      const opts = els.filter((e) => e.name === "Option");
      expect(fig).toBeDefined();
      expect(opts).toHaveLength(4);
      for (const o of opts) expect(o.x + o.w).toBeLessThanOrEqual(fig?.x ?? 0);
    }
  });
});

describe("a tile diagram that cannot draw is lost, never empty", () => {
  const bad: Figure = { diagram: { kind: "flow", alt: "x", steps: [] } };
  test("compare: the lost index is reported and every card is a text card", () => {
    const input = compareWithDiagrams(3);
    const cols = (input.columns ?? []).map((c, k) => (k === 1 ? { ...c, figure: bad } : c));
    for (const theme of THEMES) {
      const r = layoutTemplate({ ...input, columns: cols }, theme, "ks2");
      expect(r.lost).toEqual([1]);
      expect(drawn(r)).toBe(0);
      expect(r.slide.elements.filter((e) => e.name === "Label")).toHaveLength(3);
    }
  });
  test("sequence: the lost index is reported and the stages are numbered steps", () => {
    const input = sequenceWithDiagrams(3);
    const seq = (input.sequence ?? []).map((s, k) => (k === 2 ? { ...s, figure: bad } : s));
    for (const theme of THEMES) {
      const r = layoutTemplate({ ...input, sequence: seq }, theme, "ks2");
      expect(r.lost).toEqual([2]);
      expect(drawn(r)).toBe(0);
      expect(r.slide.elements.filter((e) => e.name === "Item")).toHaveLength(3);
    }
  });
  test("photo-only samples report nothing lost", () => {
    for (const theme of THEMES)
      for (const input of templateSamples(() => "x"))
        expect(layoutTemplate(input, theme, "ks2").lost).toBeUndefined();
  });
});

describe("never throws on odd tile visuals", () => {
  const odd: Figure[] = [
    { diagram: null },
    { diagram: { kind: "no-such-kind" } },
    { diagram: { kind: "labelled-diagram", shapes: "x", labels: 3 } },
    { drawn: { src: "", aspect: 0 } },
    { photo: "" },
  ];
  const inputs: TemplateInput[] = odd.flatMap((f) => [
    {
      template: "compare",
      heading: "h",
      columns: [1, 2, 3, 4, 5].map(() => ({ label: "a", text: "b", figure: f })),
    },
    {
      template: "picture-sequence",
      heading: "h",
      sequence: [1, 2, 3, 4, 5, 6].map(() => ({ caption: "c", figure: f })),
    },
    { template: "hinge", heading: "h", stem: "s", options: [], figure: f },
    {
      template: "hinge",
      heading: "h",
      stem: "word ".repeat(80),
      options: Array(8).fill("word ".repeat(20)),
      figure: f,
    },
  ]);
  for (const stage of ["ks1", "ks5"] as Stage[])
    test(`at ${stage} on every theme`, () => {
      for (const theme of THEMES)
        for (const input of inputs) {
          const r = layoutTemplate(input, theme, stage);
          expect(Array.isArray(r.slide.elements)).toBe(true);
        }
    });
});
