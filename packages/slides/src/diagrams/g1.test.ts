import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import { diagramFaults } from "./index";

const theme = getTheme("chalk");
const size = { w: 403, h: 378 };

describe("G1 diagram quality gate", () => {
  test("two particle boxes alike are panels that show no difference (F1b y7 diffusion)", () => {
    const spec = {
      kind: "labelled-diagram",
      alt: "Particles crowded, then spread.",
      title: "Water vapour spreads",
      canvas: "square",
      shapes: [
        { type: "particles", arrangement: "gas", x: 8, y: 20, w: 34, h: 50, caption: "Gas" },
        { type: "arrow", from: [45, 45], to: [55, 45] },
        { type: "particles", arrangement: "gas", x: 60, y: 20, w: 34, h: 50, caption: "Gas" },
      ],
      labels: [
        { text: "Crowded", at: [25, 45], side: "top" },
        { text: "Spread", at: [77, 45], side: "top" },
      ],
    };
    expect(diagramFaults(spec, theme, size).join(" ")).toContain("draw exactly the same");
  });
  test("labels set across the drawing's lines are faults (F1 y8 drainage basin)", () => {
    const spec = {
      kind: "labelled-diagram",
      alt: "A drainage basin.",
      canvas: "wide",
      shapes: [
        {
          type: "polygon",
          points: [
            [10, 15],
            [75, 5],
            [145, 20],
            [145, 85],
            [80, 95],
            [10, 80],
          ],
          fill: "none",
        },
        {
          type: "line",
          points: [
            [80, 15],
            [75, 45],
            [95, 65],
            [110, 90],
          ],
        },
        { type: "arrow", from: [35, 55], to: [35, 75] },
      ],
      labels: [
        { text: "Main river", at: [95, 65], side: "right" },
        { text: "Infiltration", at: [35, 65], side: "left" },
      ],
    };
    expect(diagramFaults(spec, theme, size).some((f) => f.includes("across a line"))).toBe(true);
  });
  test("a clean particle comparison passes", () => {
    const spec = {
      kind: "labelled-diagram",
      alt: "Solid and gas.",
      canvas: "wide",
      shapes: [
        { type: "particles", arrangement: "solid", x: 10, y: 20, w: 50, h: 50, caption: "Solid" },
        { type: "particles", arrangement: "gas", x: 100, y: 20, w: 50, h: 50, caption: "Gas" },
      ],
      labels: [],
    };
    expect(diagramFaults(spec, theme, size)).toEqual([]);
  });
});
