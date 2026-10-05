import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import {
  diagramFaults,
  energyProfileOf,
  normaliseDiagram,
  parseDiagram,
  renderDiagram,
} from "./index";
import { longGaps, yearOf } from "./templates";

const chalk = getTheme("chalk");

describe("DIAGRAM-AUDIT correctness guards", () => {
  test("a two-event timeline parses and draws", () => {
    const s = {
      kind: "timeline",
      alt: "Before and after",
      events: [
        { date: "1914", text: "War begins" },
        { date: "1918", text: "War ends" },
      ],
    };
    expect(parseDiagram(s)).toBeDefined();
    expect(renderDiagram(s, chalk, { w: 436, h: 356 })).toContain("<svg");
  });

  test("a labelled-diagram label needs no side", () => {
    const s = {
      kind: "labelled-diagram",
      alt: "A box",
      shapes: [{ type: "rect", x: 20, y: 20, w: 60, h: 60 }],
      labels: [{ text: "Box", at: [50, 50] }],
    };
    expect(parseDiagram(s)).toBeDefined();
  });

  test("a straight series named tangent is drawn as a tangent", () => {
    const g = {
      kind: "line-graph",
      alt: "Gas",
      x: { label: "Time / s", min: 0, max: 100 },
      y: { label: "Volume", min: 0, max: 100 },
      series: [
        {
          label: "Reaction curve",
          points: [
            [0, 0],
            [20, 40],
            [40, 64],
            [60, 80],
            [100, 88],
          ],
        },
        {
          label: "Tangent",
          points: [
            [20, 44],
            [40, 64],
            [60, 84],
          ],
          style: "line",
        },
      ],
    };
    const n = normaliseDiagram(g) as { series: { style: string }[] };
    expect(n.series[1]?.style).toBe("tangent");
    expect(n.series[0]?.style).toBe("line");
  });

  test("a single energy profile line graph maps to the figure's values", () => {
    const g = {
      kind: "line-graph",
      alt: "Profile",
      x: { label: "Reaction progress", min: 0, max: 4 },
      y: { label: "Energy", min: 0, max: 10 },
      series: [
        {
          label: "Profile",
          points: [
            [0, 4],
            [1, 7],
            [2, 10],
            [3, 6],
            [4, 2],
          ],
        },
      ],
      annotations: [
        { x: 0, y: 4, label: "Reactants" },
        { x: 4, y: 2, label: "Products" },
      ],
    };
    expect(energyProfileOf(g)).toMatchObject({
      reactants: "Reactants",
      products: "Products",
      activationEnergy: 6,
      energyChange: -2,
    });
    const rate = { ...g, x: { label: "Time (s)", min: 0, max: 4 } };
    expect(energyProfileOf(rate)).toBeUndefined();
  });

  test("every state panel holds the same number of particles", () => {
    const svg =
      renderDiagram(
        {
          kind: "particles",
          alt: "States",
          states: ["solid", "liquid", "gas"],
          arrows: ["melting", "boiling"],
        },
        chalk,
        { w: 560, h: 356 },
      ) ?? "";
    const circles = (svg.match(/<circle [^>]*stroke-width="[\d.]+"\/>/g) ?? []).length;
    expect(circles % 3).toBe(0);
    expect(circles).toBe(36);
  });

  test("a timeline with a long gap gets a break mark", () => {
    expect(yearOf("55 BC")).toBe(-55);
    expect(yearOf("AD 43")).toBe(43);
    const s = {
      kind: "timeline" as const,
      alt: "Romans",
      events: [
        { date: "55 BC", text: "Caesar lands" },
        { date: "54 BC", text: "Caesar returns" },
        { date: "AD 43", text: "Claudius invades" },
      ],
    };
    expect([...longGaps(s as never)]).toEqual([1]);
    const evenly = {
      ...s,
      events: [
        { date: "1918", text: "a" },
        { date: "1920", text: "b" },
        { date: "1923", text: "c" },
      ],
    };
    expect(longGaps(evenly as never).size).toBe(0);
    expect(diagramFaults(s, chalk, { w: 436, h: 356 })).toEqual([]);
  });
});

describe("DIAGRAM-AUDIT coverage kinds", () => {
  const { DIAGRAM_SAMPLES } = require("./samples");
  const { THEMES } = require("../themes");
  for (const k of [
    "bar-chart",
    "bar-chart-pictogram",
    "bar-chart-tally",
    "pie",
    "pie-fraction",
    "venn",
    "carroll",
  ]) {
    test(`${k} parses and draws cleanly on every theme, half and full`, () => {
      const spec = DIAGRAM_SAMPLES[k];
      expect(parseDiagram(spec)).toBeDefined();
      for (const size of [
        { w: 436, h: 356 },
        { w: 844, h: 370 },
      ])
        expect(THEMES.flatMap((t: never) => diagramFaults(spec, t, size))).toEqual([]);
    });
  }
  test("a fraction circle needs parts, a pie needs slices, not both", () => {
    expect(parseDiagram({ kind: "pie", alt: "x", parts: 4, shaded: 5 })).toBeUndefined();
    expect(parseDiagram({ kind: "pie", alt: "x" })).toBeUndefined();
  });
});

describe("DIAGRAM-AUDIT leftovers", () => {
  const { drawFigure } = require("../figures/index");
  test("catalysed against uncatalysed maps to one figure with a lower dashed peak", () => {
    const g = {
      kind: "line-graph",
      alt: "P",
      x: { label: "Reaction progress", min: 0, max: 4 },
      y: { label: "Energy (arbitrary units)", min: 0, max: 10 },
      series: [
        {
          label: "Without catalyst",
          points: [
            [0, 4],
            [1, 7],
            [2, 10],
            [3, 6],
            [4, 2],
          ],
        },
        {
          label: "With catalyst",
          points: [
            [0, 4],
            [1, 5],
            [2, 6],
            [3, 4],
            [4, 2],
          ],
        },
      ],
    };
    const v = energyProfileOf(g);
    expect(v).toMatchObject({
      activationEnergy: 6,
      catalysedActivationEnergy: 2,
      catalysedLabel: "With catalyst",
    });
    const d = drawFigure("energy-profile", v, chalk, { x: 0, y: 0, w: 436, h: 356 });
    const names = JSON.stringify(d);
    expect(names).toContain("Catalysed profile");
    // Its name clears both curves: not on the hump between the two peaks (the old spot).
    const label = (
      d.children as {
        type: string;
        x: number;
        y: number;
        w: number;
        h: number;
        style?: { color?: string };
      }[]
    ).find((k) => k.type === "text" && k.style?.color === chalk.colors.accent2);
    expect(label).toBeDefined();
    expect((label?.x ?? 0) + (label?.w ?? 0)).toBeLessThanOrEqual(436);
  });
  test("a similar pair never cuts a side label", () => {
    const v = {
      vertices: { A: "A", B: "B", C: "C" },
      sides: {
        a: { value: 5, label: "5 cm" },
        b: { value: 6, label: "6 cm" },
        c: { value: 7, label: "7 cm" },
      },
      pair: { scale: 2, vertices: { A: "P", B: "Q", C: "R" }, sides: { a: "10 cm", c: "y" } },
    };
    const d = drawFigure("triangle", v, chalk, { x: 0, y: 0, w: 436, h: 356 });
    expect(JSON.stringify(d)).not.toContain("…");
  });
  test("figure labels sit at the label weight", () => {
    const d = drawFigure(
      "energy-profile",
      { reactants: "A", products: "B", activationEnergy: 5, energyChange: -2 },
      chalk,
      { x: 0, y: 0, w: 436, h: 356 },
    );
    expect(JSON.stringify(d)).toContain('"fontWeight":500');
  });
});

describe("DIAGRAM-AUDIT figure options", () => {
  const { drawFigure } = require("../figures/index");
  const { THEMES } = require("../themes");
  const tri = {
    base: { length: 2.5, label: "2.5 m" },
    height: { label: "h" },
    hypotenuse: { length: 6.5, label: "6.5 m" },
  };
  const rect = { x: 0, y: 0, w: 436, h: 356 };
  const named = (d: { children: { name?: string }[] }, n: string) =>
    d.children.filter((k) => k.name === n);
  const inside = (d: { children: { x: number; y: number; w: number; h: number }[] }) =>
    d.children.every((k) => k.x >= -1 && k.y >= -1 && k.x + k.w <= 437 && k.y + k.h <= 357);
  test("dimension arrows with end ticks on the given sides only", () => {
    const d = drawFigure("right-triangle", { ...tri, dimensions: true }, chalk, rect);
    expect(named(d, "Dimension")).toHaveLength(2);
    expect(named(d, "Dimension tick")).toHaveLength(4);
    for (const t of THEMES)
      expect(inside(drawFigure("right-triangle", { ...tri, dimensions: true }, t, rect))).toBe(
        true,
      );
  });
  test("the ladder scene draws a wall, ground and a railed ladder on the hypotenuse", () => {
    const d = drawFigure("right-triangle", { ...tri, scene: "ladder" }, chalk, rect);
    expect(named(d, "Wall")).toHaveLength(1);
    expect(named(d, "Ground")).toHaveLength(1);
    expect(named(d, "Ladder").length).toBeGreaterThan(3);
    for (const t of THEMES)
      expect(inside(drawFigure("right-triangle", { ...tri, scene: "ladder" }, t, rect))).toBe(true);
  });
  test("the route scene draws two legs, a start, a finish and a dashed direct path", () => {
    const d = drawFigure(
      "right-triangle",
      {
        base: { length: 3, label: "3 km" },
        height: { length: 4, label: "4 km" },
        hypotenuse: { label: "d" },
        scene: "route",
      },
      chalk,
      rect,
    );
    expect(named(d, "Route")).toHaveLength(2);
    expect(named(d, "Direct path")[0]).toMatchObject({ dash: "dashed" });
    expect(named(d, "Start")).toHaveLength(1);
  });
});

describe("DIAGRAM-AUDIT coordinate distance", () => {
  const { EXTRA_FIGURES } = require("../figures/index");
  const { THEMES } = require("../themes");
  const f = EXTRA_FIGURES["coordinate-distance"];
  const v = { a: { x: 1, y: 2, label: "A" }, b: { x: 7, y: 10, label: "B" } };
  test("draws the run, the rise and the distance, inside its box on every theme", () => {
    for (const t of THEMES) {
      const d = f.draw(v, t, { w: 436, h: 356 });
      const names = d.children.map((k: { name?: string }) => k.name);
      expect(names).toContain("Run");
      expect(names).toContain("Rise");
      expect(names).toContain("Distance");
      expect(
        d.children.every(
          (k: { x: number; y: number; w: number; h: number }) =>
            k.x >= -8 && k.y >= -8 && k.x + k.w <= 444 && k.y + k.h <= 364,
        ),
      ).toBe(true);
    }
    expect(f.unknown(v).value).toBe(10);
  });
  test("points on one line are refused", () => {
    expect(f.values.safeParse({ a: { x: 1, y: 2 }, b: { x: 1, y: 6 } }).success).toBe(false);
  });
});
