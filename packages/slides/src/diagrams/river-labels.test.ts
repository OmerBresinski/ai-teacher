import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import { diagramGeometryFaults } from "./geometry";
import { lastDiagramProbe } from "./index";
import { TEMPLATE_SPECS } from "./template-specs";

/*
 * TEACH-247 part bf: a river or hydrograph label never sits on the drawing's own paths (the
 * channel's banks, the sand, arrows, other leaders), and a leader ends at its label's edge, never
 * through its words (Rivers v417 s6: "Inner bank" on the sand, its leader through the text).
 */
type Seg = [number, number, number, number];
type Box = { x0: number; y0: number; x1: number; y1: number; text?: string };

/** True when segment s passes through the box shrunk by `inset` (touching an edge is fine). */
function cuts(s: Seg, b: Box, inset = 1.5): boolean {
  const x0 = b.x0 + inset;
  const x1 = b.x1 - inset;
  const y0 = b.y0 + inset;
  const y1 = b.y1 - inset;
  if (x0 >= x1 || y0 >= y1) return false;
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const px = s[0] + ((s[2] - s[0]) * i) / steps;
    const py = s[1] + ((s[3] - s[1]) * i) / steps;
    if (px > x0 && px < x1 && py > y0 && py < y1) return true;
  }
  return false;
}

const plan = (labels: [string, string][]) => ({
  kind: "river",
  alt: "A meander from above.",
  view: "meander-plan",
  labels: labels.map(([part, text]) => ({ part, text })),
});
const SPECS: Record<string, unknown> = {
  // the v417 s6 drawing, as the drawer and the writer asked it
  "plan-v417": plan([
    ["flow-direction", "Flow"],
    ["fastest-flow", "Fast flow"],
    ["outer-bank", "Erosion"],
    ["inner-bank", "Deposition"],
  ]),
  "plan-banks": plan([
    ["outer-bank", "Outer bank"],
    ["inner-bank", "Inner bank"],
    ["fastest-flow", "Fast flow"],
  ]),
  "plan-slope": plan([
    ["river-cliff", "River cliff"],
    ["slip-off-slope", "Slip-off slope"],
    ["inner-bank", "Inner bank"],
  ]),
  ...Object.fromEntries(
    Object.entries(TEMPLATE_SPECS).filter(
      ([k]) => k.startsWith("river") || k.startsWith("hydrograph"),
    ),
  ),
};
const SIZES = [
  { w: 348, h: 284 },
  { w: 392, h: 328 },
  { w: 490, h: 245 },
  { w: 844, h: 370 },
];

describe("river and hydrograph labels stand clear of every path (part bf)", () => {
  for (const [name, spec] of Object.entries(SPECS))
    test(name, () => {
      const hits: string[] = [];
      let shipped = 0;
      for (const t of THEMES)
        for (const size of SIZES) {
          // A drawing with a fault never ships (drawDiagram takes a simpler form): only a clean
          // one is held to this.
          if (diagramGeometryFaults(spec, t, size).length) continue;
          const p = lastDiagramProbe();
          if (!p) continue;
          shipped++;
          const boxes = p.rec as Box[];
          const segs = [...(p.strokes as Seg[]), ...((p.leaders ?? []) as Seg[])];
          for (const b of boxes)
            for (const s of segs)
              if (cuts(s, b))
                hits.push(`${t.id} ${size.w}x${size.h}: "${b.text}" cut by ${s.map(Math.round)}`);
        }
      expect([...new Set(hits)].slice(0, 6)).toEqual([]);
      // the check never leaves a view with nothing to ship
      expect(shipped).toBeGreaterThan(0);
    }, 60_000);
});
