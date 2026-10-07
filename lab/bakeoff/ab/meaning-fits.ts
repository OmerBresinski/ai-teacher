// A/B arm a3: measured limits for the two new kinds, the same way lab/bakeoff/diagram-limits.ts
// measured round 5's (drawDiagram's readability checks on the studio theme, side 348x284 and full
// 788x235, per key stage). Writes catalogue/diagrams.json + these two kinds to <out.json>, the input
// a3's make_visuals.py turns into Fits clauses. No model calls.
// bun lab/bakeoff/ab/meaning-fits.ts <catalogue/diagrams.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { drawDiagram } from "../../../packages/slides/src/diagrams";
import { getTheme, withKeyStage } from "../../../packages/slides/src/themes";

const SLOTS = { side: { w: 348, h: 284 }, full: { w: 788, h: 235 } } as const;
const STAGES = ["ks1", "ks2", "ks3", "ks4", "ks5"] as const;
const theme = getTheme("studio");
const draws = (spec: unknown, ks: string, slot: keyof typeof SLOTS) =>
  withKeyStage(ks, () => drawDiagram(spec, theme, { x: 0, y: 0, ...SLOTS[slot] }).ok);
const most = (lo: number, hi: number, ok: (n: number) => boolean) => {
  let best = 0;
  for (let n = lo; n <= hi; n++) if (ok(n)) best = n;
  return best;
};
const groups = (g: number, each: number) => ({
  kind: "equal-groups",
  alt: "x",
  total: g * each,
  groups: g,
});
const shapes = (n: number, parts: number) => ({
  kind: "fraction-shapes",
  alt: "x",
  shapes: Array.from({ length: n }, (_, i) => ({
    shape: "rectangle",
    parts,
    cut: "vertical",
    shaded: 1,
    name: "ABCD"[i],
  })),
});
const out: Record<string, Record<string, unknown>> = { "equal-groups": {}, "fraction-shapes": {} };
for (const ks of STAGES)
  for (const slot of ["side", "full"] as const) {
    out["equal-groups"]![`${ks}.${slot}`] = {
      maxGroups: { each5: most(2, 10, (g) => draws(groups(g, 5), ks, slot)) },
      maxEach: { groups4: most(1, 12, (e) => draws(groups(4, e), ks, slot)) },
    };
    out["fraction-shapes"]![`${ks}.${slot}`] = {
      maxShapes: { parts4: most(1, 4, (n) => draws(shapes(n, 4), ks, slot)) },
      maxParts: { shapes2: most(2, 12, (p) => draws(shapes(2, p), ks, slot)) },
    };
  }
const cat = JSON.parse(readFileSync(process.argv[2] as string, "utf8"));
cat.kinds = { ...cat.kinds, ...out };
cat.generated = `${cat.generated}; + equal-groups, fraction-shapes by lab/bakeoff/ab/meaning-fits.ts`;
writeFileSync(process.argv[3] as string, JSON.stringify(cat, null, 1));
console.log(JSON.stringify(out));
