// Round 9 (regression audit cause 3): each diagram kind's limits per slot, measured from what the
// renderer actually draws in that slot. A slot is the diagram box a layout gives (read from
// layoutTemplate's own Diagram element, never typed); a kind's limit is the most items, then the
// longest label at that count, with which the slide lays out with its diagram kept (no "the flow
// does not fit its zone") on every theme of the key stage. No model calls.
// bun lab/bakeoff/slot-limits.ts [out.ts]   (default packages/slides/src/diagrams/slot-limits.gen.ts)
import { writeFileSync } from "node:fs";
import { fromMeaning } from "../../packages/slides/src/diagrams/meaning";
import { MEANING_SAMPLES } from "../../packages/slides/src/diagrams/meaning-samples";
import { DIAGRAM_SAMPLES } from "../../packages/slides/src/diagrams/samples";
import { TEMPLATE_SPECS } from "../../packages/slides/src/diagrams/template-specs";
import { atFullSize, layoutTemplate } from "../../packages/slides/src/templates/index";
import { getTheme } from "../../packages/slides/src/themes";

/** The writer's key-stage groups, their themes (prompts/shared/themes.txt) and the stages they cover. */
export const GROUPS = {
  KS1: { stages: ["ks1"], themes: ["playground", "crayon", "splash", "chalk"] },
  KS2: { stages: ["ks2"], themes: ["crayon", "splash", "treehouse", "chalk"] },
  "KS3-5": {
    stages: ["ks3", "ks4", "ks5"],
    themes: ["chalk", "reading-room", "studio", "exam-hall"],
  },
} as const;
/** Each slot and the layout whose diagram box it is (every other layout's box is measured into one of these). */
const SLOT_LAYOUT = { side: "diagram-text", full: "big-diagram" } as const;
/** The layouts that place a diagram, by the slot they give (checked against the measured boxes below). */
const LAYOUTS_IN = {
  side: ["diagram-text", "steps", "equation-hero", "question-set", "practice", "exit-ticket"],
  full: ["big-diagram"],
} as const;
type Slot = keyof typeof SLOT_LAYOUT;

const POOL = "Government pays workers money prices rise falls the and output".split(" ");
const words = (n: number) => {
  let s = "";
  for (let i = 0; s.length < n; i++) s += (s ? " " : "") + POOL[i % POOL.length];
  return s.slice(0, n).trim();
};
const text = (c: number, i: number) => `${words(Math.max(1, c - 2))} ${i + 1}`.slice(0, c).trim();
const sample = (kind: string) =>
  Object.values({ ...DIAGRAM_SAMPLES, ...TEMPLATE_SPECS, ...MEANING_SAMPLES }).find(
    (v) => (v as { kind?: string }).kind === kind,
  ) as Record<string, unknown> | undefined;

/**
 * A probe of `k` main items with labels of `c` characters, per kind; the noun the writer reads.
 * `cmin` is the shortest label that still says something (a flow box of 16 characters, "Prices rise
 * fast"): the count is the most items that draw with labels that long, then the label limit is the
 * longest that draws at that count.
 */
const PROBES: Record<
  string,
  {
    noun: string;
    min: number;
    max: number;
    cmin: number;
    /** Round 9 (review N2): the count the label limit is measured at, when not the most items. */
    charsAt?: number;
    spec: (k: number, c: number) => unknown;
  }
> = {
  flow: {
    noun: "boxes",
    min: 2,
    max: 8,
    cmin: 16,
    spec: (k, c) => ({
      kind: "flow",
      alt: "x",
      nodes: Array.from({ length: k }, (_, i) => text(c, i)),
      links: Array.from({ length: k - 1 }, (_, i) => ({ from: i, to: i + 1, label: "then" })),
    }),
  },
  cycle: {
    noun: "stages",
    min: 3,
    max: 6,
    cmin: 14,
    spec: (k, c) => ({
      kind: "cycle",
      alt: "x",
      steps: Array.from({ length: k }, (_, i) => text(c, i)),
    }),
  },
  timeline: {
    noun: "events",
    min: 2,
    max: 8,
    cmin: 16,
    spec: (k, c) => ({
      kind: "timeline",
      alt: "x",
      events: Array.from({ length: k }, (_, i) => ({
        date: String(1900 + 5 * i),
        text: text(c, i),
      })),
    }),
  },
  table: {
    noun: "rows of 3 columns",
    min: 1,
    max: 8,
    cmin: 6,
    spec: (k, c) => ({
      kind: "table",
      alt: "x",
      header: ["Name", "Value", "Note"],
      rows: Array.from({ length: k }, (_, i) => [text(c, i), text(c, i + 1), text(c, i + 2)]),
    }),
  },
  "bar-model": {
    noun: "parts",
    min: 1,
    max: 12,
    cmin: 3,
    charsAt: 4,
    spec: (k, c) => ({
      kind: "bar-model",
      alt: "x",
      bars: [
        {
          parts: Array.from({ length: k }, () => ({ value: 8, label: "9".repeat(c) })),
          total: String(8 * k),
        },
      ],
    }),
  },
  "line-graph": {
    noun: "notes",
    min: 0,
    max: 4,
    cmin: 10,
    spec: (k, c) => ({
      kind: "line-graph",
      alt: "x",
      x: { label: "Time / s", min: 0, max: 60 },
      y: { label: "Volume / cm³", min: 0, max: 60 },
      series: [
        {
          label: "Curve A",
          points: [
            [0, 0],
            [20, 30],
            [40, 50],
            [60, 60],
          ],
        },
      ],
      annotations: Array.from({ length: k }, (_, i) => ({
        x: 10 + i * 14,
        y: 20 + i * 8,
        label: text(c, i),
      })),
    }),
  },
  particles: {
    noun: "panels",
    min: 1,
    max: 3,
    cmin: 6,
    spec: (k, c) => ({
      kind: "particles",
      alt: "x",
      states: ["solid", "liquid", "gas"].slice(0, k),
      notes: Array.from({ length: k }, (_, i) => text(c, i)),
    }),
  },
  // Round 9 (coordinator 7): number-line points (labelled values on -5..5) and cubes' split.
  "number-line": {
    noun: "marked points",
    min: 1,
    max: 8,
    cmin: 3,
    spec: (k, c) => ({
      kind: "number-line",
      alt: "x",
      min: -5,
      max: 5,
      step: 1,
      points: Array.from({ length: k }, (_, i) => ({
        value: -5 + Math.round(((i + 1) * 10) / (k + 1)),
        label: text(c, i),
      })),
    }),
  },
  cubes: {
    noun: "cubes along each edge",
    min: 2,
    max: 4,
    cmin: 0,
    spec: (k) => ({ ...(sample("cubes") ?? {}), split: k }),
  },
  "equal-groups": {
    noun: "groups",
    min: 2,
    max: 10,
    cmin: 0,
    spec: (k) => ({ kind: "equal-groups", alt: "x", total: 3 * k, groups: k }),
  },
};
/** Kinds grown from their sample's main list (labels of `c` characters). */
const MAIN: Record<string, [string, string]> = {
  "labelled-diagram": ["labels", "labels"],
  "bar-chart": ["bars", "bars"],
  pie: ["slices", "slices"],
  venn: ["items", "items"],
  layers: ["layers", "layers"],
  river: ["labels", "labels"],
  carroll: ["cells", "sorted items"],
  "fraction-shapes": ["shapes", "shapes"],
};
const relabel = (o: unknown, t: string, i: number, base: Record<string, unknown>): unknown => {
  if (typeof o === "string") return t;
  if (Array.isArray(o)) return o.map((x) => relabel(x, t, i, base));
  if (!o || typeof o !== "object") return o;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && ["label", "text", "name", "caption"].includes(k)) out[k] = t;
    else if (k === "value" && typeof v === "number" && base.kind === "number-line") {
      const lo = base.min as number;
      const hi = base.max as number;
      out[k] = lo + Math.round(((i + 1) * (hi - lo)) / 12);
    } else if (k === "value" && typeof v === "number") out[k] = v + i;
    else out[k] = v;
  }
  return out;
};
for (const [kind, [field, noun]] of Object.entries(MAIN)) {
  const base = sample(kind);
  const items = (base?.[field] as unknown[]) ?? [];
  if (!base || !items.length) continue;
  PROBES[kind] = {
    noun,
    min: 1,
    max: 12,
    cmin: kind === "fraction-shapes" ? 1 : kind === "number-line" ? 3 : 10,
    spec: (k, c) => ({
      ...base,
      [field]: Array.from({ length: k }, (_, i) =>
        relabel(items[i % items.length], text(c, i), i, base),
      ),
    }),
  };
}

type Group = keyof typeof GROUPS;
const LEAD = "What this shows.";
/** Whether the slide keeps `spec` in `slot` on every theme and stage of `g` (the renderer's own fit). */
function draws(spec: unknown, g: Group, slot: Slot): boolean {
  const drawn = fromMeaning(spec);
  return GROUPS[g].themes.every((th) =>
    GROUPS[g].stages.every((st) =>
      atFullSize(() => {
        try {
          const r = layoutTemplate(
            {
              template: SLOT_LAYOUT[slot],
              heading: "Heading",
              lead: LEAD,
              points: ["One point", "Another point"],
              figure: { diagram: drawn },
            } as never,
            getTheme(th),
            st as never,
          ) as { diagram?: string[] };
          return !r.diagram?.length;
        } catch {
          return false;
        }
      }),
    ),
  );
}
const most = (lo: number, hi: number, ok: (n: number) => boolean, step = 1) => {
  let best = -1;
  for (let n = lo; n <= hi; n += step) if (ok(n)) best = n;
  return best;
};

/** The Diagram element's box for `template` (smallest across the group's themes and stages). */
function box(template: string, g: Group) {
  let w = Infinity;
  let h = Infinity;
  const spec = { kind: "cycle", alt: "x", steps: ["A", "B", "C"] };
  for (const th of GROUPS[g].themes)
    for (const st of GROUPS[g].stages) {
      const r = atFullSize(() =>
        layoutTemplate(
          {
            template,
            heading: "Heading",
            lead: LEAD,
            points: ["One", "Two"],
            questions: ["Q1", "Q2"],
            formula: "a = b",
            figure: { diagram: spec },
          } as never,
          getTheme(th),
          st as never,
        ),
      ) as { slide: { elements: { type: string; name?: string; w?: number; h?: number }[] } };
      const e = r.slide.elements.find((x) => x.type === "image");
      if (e?.w && e.h) {
        w = Math.min(w, Math.floor(e.w));
        h = Math.min(h, Math.floor(e.h));
      }
    }
  return { w, h };
}

export function measure() {
  const slots: Record<string, Record<string, { w: number; h: number; layouts: string[] }>> = {};
  const limits: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const g of Object.keys(GROUPS) as Group[]) {
    slots[g] = {};
    limits[g] = {};
    for (const slot of Object.keys(SLOT_LAYOUT) as Slot[]) {
      const b = box(SLOT_LAYOUT[slot], g);
      // Every layout said to give this slot must give the same box (else the table would lie).
      for (const l of LAYOUTS_IN[slot]) {
        const o = box(l, g);
        if (o.w !== b.w || o.h !== b.h)
          throw new Error(`${l} gives ${o.w}x${o.h} at ${g}, not the ${slot} slot's ${b.w}x${b.h}`);
      }
      slots[g][slot] = { ...b, layouts: [...LAYOUTS_IN[slot]] };
      const out: Record<string, unknown> = {};
      for (const [kind, p] of Object.entries(PROBES)) {
        const items = Math.max(
          0,
          most(p.min, p.max, (k) => draws(p.spec(k, p.cmin), g, slot)),
        );
        const chars =
          items && p.cmin
            ? Math.max(
                0,
                most(
                  p.cmin,
                  60,
                  (c) => draws(p.spec(Math.min(items, p.charsAt ?? items), c), g, slot),
                  2,
                ),
              )
            : 0;
        out[kind] = { items, ...(p.cmin ? { chars } : {}), noun: p.noun };
      }
      out.hydrograph = { items: draws(sample("hydrograph"), g, slot) ? 1 : 0, noun: "graph" };
      limits[g][slot] = out;
    }
  }
  return {
    note: "generated by lab/bakeoff/slot-limits.ts from layoutTemplate's own fit; do not edit",
    slots,
    limits,
  };
}

/** The generated module's source (biome-ignored data; limits.ts reads it). */
export const slotLimitsSource = (t: ReturnType<typeof measure>) =>
  `// Generated by lab/bakeoff/slot-limits.ts (bun lab/bakeoff/slot-limits.ts); do not edit.\n// biome-ignore format: generated table\nexport const SLOT_TABLE = ${JSON.stringify(t)} as const;\n`;

if (import.meta.main) {
  const out =
    process.argv[2] ?? `${import.meta.dir}/../../packages/slides/src/diagrams/slot-limits.gen.ts`;
  writeFileSync(out, slotLimitsSource(measure()));
  console.log("wrote", out);
}
