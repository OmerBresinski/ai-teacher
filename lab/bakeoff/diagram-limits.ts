// dd-diagrams2: measures each diagram kind's limits per key stage and slot with the drawer's real
// readability checks (drawDiagram), for the writer menu's "fits:" lines. No model calls.
// bun lab/bakeoff/diagram-limits.ts <out.json>
import { writeFileSync } from "node:fs";
import { drawDiagram } from "../../packages/slides/src/diagrams";
import { getTheme, withKeyStage } from "../../packages/slides/src/themes";

const SLOTS = { side: { w: 348, h: 284 }, full: { w: 788, h: 235 } } as const;
const STAGES = ["ks1", "ks2", "ks3", "ks4", "ks5"] as const;
const theme = getTheme("studio");
const words = (n: number) => {
  const pool = [
    "Government",
    "pays",
    "workers",
    "money",
    "prices",
    "rise",
    "falls",
    "the",
    "and",
    "output",
  ];
  let s = "";
  for (let i = 0; s.length < n; i++) s += (s ? " " : "") + pool[i % pool.length];
  return s.slice(0, n).trim();
};
const draws = (spec: unknown, ks: string, slot: keyof typeof SLOTS) =>
  withKeyStage(ks, () => drawDiagram(spec, theme, { x: 0, y: 0, ...SLOTS[slot] }).ok);
const most = (lo: number, hi: number, ok: (n: number) => boolean) => {
  let best = 0;
  for (let n = lo; n <= hi; n++) if (ok(n)) best = n;
  return best;
};

const flow = (k: number, chars: number) => ({
  kind: "flow",
  alt: "x",
  steps: Array.from({ length: k }, (_, i) => ({ label: words(chars - 2) + ` ${i + 1}` })),
});
const bar = (parts: number, bars = 1, label = "8") => ({
  kind: "bar-model",
  alt: "x",
  bars: Array.from({ length: bars }, () => ({
    parts: Array.from({ length: parts }, () => ({ value: 8, label })),
    total: String(8 * parts),
  })),
});
const graph = (series: number, ann: number, annChars: number) => ({
  kind: "line-graph",
  alt: "x",
  x: { label: "Time / s", min: 0, max: 60 },
  y: { label: "Volume / cm³", min: 0, max: 60 },
  series: Array.from({ length: series }, (_, j) => ({
    label: `Curve ${"ABC"[j]}`,
    points: [
      [0, 0],
      [20, 30 - j * 8],
      [40, 50 - j * 10],
      [60, 60 - j * 12],
    ],
  })),
  annotations: Array.from({ length: ann }, (_, i) => ({
    x: 15 + i * 15,
    y: 20 + i * 8,
    label: words(annChars),
  })),
});
const table = (rows: number, cols: number, chars: number) => ({
  kind: "table",
  alt: "x",
  header: Array.from({ length: cols }, (_, i) => `Col ${i + 1}`),
  rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => "9".repeat(chars))),
});
const particles = (panels: number, noteChars: number) => ({
  kind: "particles",
  alt: "x",
  states: ["solid", "liquid", "gas"].slice(0, panels),
  notes: Array.from({ length: panels }, () => words(noteChars)),
  arrows: panels > 1 ? ["melting", "boiling"].slice(0, panels - 1) : undefined,
});

const out: Record<string, unknown> = {
  generated:
    "lab/bakeoff/diagram-limits.ts (drawDiagram readability checks: labels >= the stage's small size and 18 pt, no overlap, cut or clipping, plot aspect)",
  slots: SLOTS,
  required: {
    "line-graph":
      'x and y axes each with a label naming the quantity and its unit ("Time / s"); min < max covering every point; at most 3 series; an energy profile (x "Reaction progress", y "Energy") draws without numbers',
    "bar-model":
      'part labels are quantities (number, fraction, "?" or one letter); a total that starts with a number equals the sum of the parts',
    flow: "steps in order; arrow words optional (dropped first when space is short)",
    particles:
      "states (each once), diffusion, dissolving, compare (2-3 panels differing in count, extra, speed or room) or collision (bounces or reacts)",
    table: "every row has one cell per column",
  },
  kinds: {} as Record<string, unknown>,
};
const kinds = out.kinds as Record<string, Record<string, Record<string, unknown>>>;
for (const ks of STAGES)
  for (const slot of Object.keys(SLOTS) as (keyof typeof SLOTS)[]) {
    const put = (kind: string, v: Record<string, unknown>) => {
      kinds[kind] ??= {};
      kinds[kind][`${ks}.${slot}`] = v;
    };
    put("flow", {
      maxSteps: {
        labels12: most(2, 8, (k) => draws(flow(k, 12), ks, slot)),
        labels20: most(2, 8, (k) => draws(flow(k, 20), ks, slot)),
        labels32: most(2, 8, (k) => draws(flow(k, 32), ks, slot)),
      },
      maxLabelChars: { steps4: most(6, 48, (c) => draws(flow(4, c), ks, slot)) },
    });
    put("bar-model", {
      maxParts: {
        oneBar: most(1, 12, (p) => draws(bar(p), ks, slot)),
        twoBars: most(1, 12, (p) => draws(bar(p, 2), ks, slot)),
      },
      maxBars: most(1, 4, (b) => draws(bar(4, b), ks, slot)),
      maxPartLabelChars: { parts5: most(1, 10, (c) => draws(bar(5, 1, "9".repeat(c)), ks, slot)) },
    });
    put("line-graph", {
      maxSeries: most(1, 3, (sN) => draws(graph(sN, 0, 10), ks, slot)),
      maxAnnotations: { labels12: most(0, 4, (a) => draws(graph(1, a, 12), ks, slot)) },
      maxAnnotationChars: { two: most(4, 24, (c) => draws(graph(1, 2, c), ks, slot)) },
    });
    put("table", {
      maxRows: { cols3: most(1, 8, (r) => draws(table(r, 3, 6), ks, slot)) },
      maxCols: { rows4: most(1, 5, (c) => draws(table(4, c, 6), ks, slot)) },
      maxCellChars: { cols3rows4: most(1, 28, (ch) => draws(table(4, 3, ch), ks, slot)) },
    });
    put("particles", {
      maxPanels: most(1, 3, (p) => draws(particles(p, 8), ks, slot)),
      maxNoteChars: { panels3: most(0, 28, (c) => draws(particles(3, c), ks, slot)) },
    });
  }
writeFileSync(process.argv[2] ?? "diagram-limits.json", `${JSON.stringify(out, null, 1)}\n`);
console.log("wrote", process.argv[2]);
