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

  test("a plain storm hydrograph becomes the hydrograph template, keeping its numbers (round I)", () => {
    const g = parseDiagram(normaliseDiagram(specs.hydroOnePeak));
    if (g?.kind !== "hydrograph") throw new Error(`not the template: ${g?.kind}`);
    expect(g.values?.peakDischarge).toBeGreaterThan(0);
    expect(g.values?.lagHours).toBeGreaterThan(0);
  });

  test("a hydrograph with a threshold line keeps its own drawing", () => {
    expect(parseDiagram(normaliseDiagram(specs.hydroCapacity))?.kind).toBe("line-graph");
  });

  test("a particle row becomes the particles template, one note per state (round I)", () => {
    const d = parseDiagram(normaliseDiagram(specs.particlesWall));
    if (d?.kind !== "particles") throw new Error(`not the template: ${d?.kind}`);
    expect(d.states).toHaveLength(3);
    expect(new Set(d.states).size).toBe(3);
  });

  test("a spec of another kind comes back unchanged", () => {
    const flow = { kind: "flow", alt: "a", steps: [{ label: "A" }, { label: "B" }] };
    expect(normaliseDiagram(flow)).toBe(flow);
  });
});
