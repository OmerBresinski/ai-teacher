// readGraph (BAKEOFF D44, b3-r2-1 y11 s11 "Interpret two reactions"): a measured line graph gets
// graph paper (an upright line at every x tick, faint minor lines at a fifth of the y step) and a
// dot on every plotted point, so a value can be read off it.
import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import { parseDiagram, renderDiagram } from "./index";

const series = (label: string, ys: number[]) => ({
  label,
  points: ys.map((y, i) => [i * 20, y]),
  style: "line",
  axis: "left",
});
const spec = (qualitative: boolean) =>
  parseDiagram({
    kind: "line-graph",
    alt: "A reaches 20 at 20 s; B reaches 32 at 20 s.",
    x: { label: "Time (s)", min: 0, max: 100, step: 20 },
    y: { label: "Gas volume (cm³)", min: 0, max: 40, step: 10 },
    qualitative,
    series: [series("A", [0, 20, 32, 38, 40, 40])],
  });

describe("readGraph", () => {
  test("x-tick gridlines, 4 minor lines in each y step, and a dot per point", () => {
    const s = spec(false);
    expect(s).toBeDefined();
    const svg = renderDiagram(s as never, getTheme("chalk"), { w: 788, h: 253 }) ?? "";
    // 6 upright lines at the x ticks and 4 minor lines in each of the 4 y steps, besides the axes
    // and the y gridlines (the theme's finish restyles their strokes, so they are counted).
    expect((svg.match(/<line /g) ?? []).length).toBeGreaterThanOrEqual(6 + 16);
    // one dot per plotted point
    expect((svg.match(/<circle /g) ?? []).length).toBe(6);
  });
});
