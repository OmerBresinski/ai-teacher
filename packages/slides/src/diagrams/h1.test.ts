import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import specs from "./h1-specs.json";
import { diagramFaults, normaliseDiagram, parseDiagram, settleDiagram } from "./index";

/*
 * Round H: the two core drawings pass the geometry gate on all 10 themes for typical specs. The
 * specs are the writers' own from earlier rounds whose drawings failed the G gate (a threshold
 * line's legend running off, peak labels colliding, particle captions running into each other).
 */
const SIZES = [
  { w: 403, h: 336 },
  { w: 403, h: 378 },
  { w: 490, h: 245 },
];

const failing = (spec: unknown) =>
  SIZES.flatMap((size) => {
    const settled = settleDiagram(spec, size).spec;
    return THEMES.flatMap((t) =>
      diagramFaults(settled, t, size).map((f) => `${t.id} ${size.w}x${size.h}: ${f}`),
    );
  });

describe("H1 core diagrams", () => {
  for (const [name, spec] of Object.entries(specs)) {
    test(`${name} draws cleanly on every theme and slot`, () => {
      expect(failing(spec)).toEqual([]);
    });
  }

  test("a hydrograph gains its missing peak label and the lag between the peaks", () => {
    const g = parseDiagram(normaliseDiagram(specs.hydroOnePeak));
    if (g?.kind !== "line-graph") throw new Error("not a line graph");
    expect(g.annotations.map((a) => a.label)).toContain("Peak rainfall");
    expect(g.intervals).toHaveLength(1);
    expect(g.intervals[0]?.y).toBeUndefined();
  });

  test("a particle row is equal boxes in one row, one description under each", () => {
    const d = parseDiagram(normaliseDiagram(specs.particlesWall));
    if (d?.kind !== "labelled-diagram") throw new Error("not a labelled diagram");
    const boxes = d.shapes.filter((s) => s.type === "particles");
    expect(boxes).toHaveLength(3);
    expect(new Set(boxes.map((b) => (b.type === "particles" ? b.w : 0))).size).toBe(1);
    expect(d.shapes.some((s) => s.type === "line")).toBe(false);
    expect(d.labels.every((l) => l.side === "bottom")).toBe(true);
    expect(d.labels.map((l) => l.text)).not.toContain("Container wall");
  });

  test("a spec of another kind comes back unchanged", () => {
    const flow = { kind: "flow", alt: "a", steps: [{ label: "A" }, { label: "B" }] };
    expect(normaliseDiagram(flow)).toBe(flow);
  });
});
