/**
 * DIAGRAM-AUDIT item 6: each kind's capacity per zone, derived from the renderer itself at the
 * 18 pt floor, so the writer's menu and the validator use numbers that cannot drift from the
 * drawing code. A capacity is the most items (events, steps, bars, rows, set items) a probe spec of
 * typical label length draws with no fault on every theme in that zone.
 */
import { THEMES } from "../themes";
import { diagramFaults } from "./index";

/** The zones a drawing is placed in, in slide points: beside text, and the big diagram. */
export const DIAGRAM_ZONES = {
  half: { w: 422, h: 540 },
  full: { w: 844, h: 380 },
} as const;
export type DiagramZone = keyof typeof DIAGRAM_ZONES;

const words = (n: number) =>
  [
    "Rising prices",
    "Strikes spread",
    "New leader",
    "Treaty signed",
    "Army returns",
    "Crash hits",
    "Vote held",
    "Party banned",
  ][n % 8] as string;

/** A probe spec of `k` items of typical length, per kind with a count to size. */
const PROBES: Record<
  string,
  { min: number; max: number; noun: string; spec: (k: number) => unknown }
> = {
  timeline: {
    min: 2,
    max: 7,
    noun: "events",
    spec: (k) => ({
      kind: "timeline",
      alt: "p",
      title: "Key dates",
      events: Array.from({ length: k }, (_, i) => ({
        date: String(1910 + 3 * i),
        text: `${words(i)} across the country`,
      })),
    }),
  },
  flow: {
    min: 2,
    max: 6,
    noun: "steps",
    spec: (k) => ({
      kind: "flow",
      alt: "p",
      title: "The process",
      layout: "chain",
      steps: Array.from({ length: k }, (_, i) => ({
        label: words(i),
        ...(i < k - 1 ? { arrow: "then" } : {}),
      })),
    }),
  },
  cycle: {
    min: 3,
    max: 5,
    noun: "steps",
    spec: (k) => ({
      kind: "cycle",
      alt: "p",
      title: "The cycle",
      steps: Array.from({ length: k }, (_, i) => `${words(i)} again`),
    }),
  },
  table: {
    min: 1,
    max: 8,
    noun: "rows",
    spec: (k) => ({
      kind: "table",
      alt: "p",
      title: "Compared",
      header: ["Name", "Feature", "Example"],
      rows: Array.from({ length: k }, (_, i) => [words(i), "A short phrase", "Another one"]),
    }),
  },
  "bar-chart": {
    min: 1,
    max: 8,
    noun: "bars",
    spec: (k) => ({
      kind: "bar-chart",
      alt: "p",
      title: "Counts",
      bars: Array.from({ length: k }, (_, i) => ({ label: words(i).split(" ")[0], value: 3 + i })),
    }),
  },
  venn: {
    min: 0,
    max: 12,
    noun: "items",
    spec: (k) => ({
      kind: "venn",
      alt: "p",
      title: "Sorted",
      sets: ["Even", "Square"],
      items: Array.from({ length: k }, (_, i) => ({
        text: String(i + 1),
        in: [[0], [1], [0, 1], []][i % 4],
      })),
    }),
  },
  "bar-model": {
    min: 1,
    max: 12,
    noun: "parts",
    spec: (k) => ({
      kind: "bar-model",
      alt: "p",
      title: "Parts",
      bars: [{ label: "Total", parts: Array.from({ length: k }, () => ({ label: "12" })) }],
    }),
  },
};

const clean = (spec: unknown, zone: DiagramZone) =>
  THEMES.every((t) => diagramFaults(spec, t, DIAGRAM_ZONES[zone]).length === 0);

let cache: Record<string, { noun: string; half: number; full: number }> | undefined;

/** Each sized kind's capacity in the half and full zones (0: none fit). Computed once. */
export function diagramCapacities(): Record<string, { noun: string; half: number; full: number }> {
  if (cache) return cache;
  const out: Record<string, { noun: string; half: number; full: number }> = {};
  for (const [kind, p] of Object.entries(PROBES)) {
    const most = (zone: DiagramZone) => {
      let best = 0;
      for (let k = p.min; k <= p.max; k++) if (clean(p.spec(k), zone)) best = k;
      return best;
    };
    out[kind] = { noun: p.noun, half: most("half"), full: most("full") };
  }
  cache = out;
  return out;
}

/** How many items `spec` carries in its sized dimension, or undefined for an unsized kind. */
export function itemCount(spec: unknown): number | undefined {
  const s = spec as Record<string, unknown> | null;
  if (!s || typeof s !== "object") return undefined;
  const len = (v: unknown) => (Array.isArray(v) ? v.length : undefined);
  switch (s.kind) {
    case "timeline":
      return len(s.events);
    case "flow":
    case "cycle":
      return len(s.steps);
    case "table":
      return len(s.rows);
    case "bar-chart":
      return len(s.bars);
    case "venn":
      return len(s.items);
    case "bar-model":
      return Math.max(
        0,
        ...((s.bars as { parts?: unknown[] }[] | undefined) ?? []).map((b) => b.parts?.length ?? 0),
      );
    default:
      return undefined;
  }
}

/** The capacity clause for a kind's menu line: "up to 5 events beside text, 7 on a big diagram". */
export function capacityLine(kind: string): string | undefined {
  const c = diagramCapacities()[kind];
  if (!c) return undefined;
  return c.half === c.full
    ? `up to ${c.full} ${c.noun}`
    : `up to ${c.half} ${c.noun} beside text, ${c.full} on a big diagram`;
}

/** A zone's shape in words, from its width over height: "portrait, about 4:5". */
export function zoneShape(w: number, h: number): string {
  const r = w / h;
  const ratios: [number, string][] = [
    [3 / 4, "3:4"],
    [4 / 5, "4:5"],
    [1, "1:1"],
    [4 / 3, "4:3"],
    [16 / 9, "16:9"],
    [2, "2:1"],
    [7 / 3, "7:3"],
  ];
  const near = ratios.reduce((a, b) => (Math.abs(b[0] - r) < Math.abs(a[0] - r) ? b : a));
  const kind = r < 0.92 ? "portrait" : r > 1.08 ? "landscape" : "square";
  return `${kind}, about ${near[1]}`;
}
