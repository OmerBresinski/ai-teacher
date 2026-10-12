import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import { diagramElement, renderDiagram } from "./index";

/*
 * TEACH-247 ac: Sol's "Blood does not disappear" (writer test, 12 Oct). Two arrows fanning out of
 * Heart put their words one over the other ("delivery" / "to lungs", read as "delivery to lungs"),
 * and the link back from Muscles dropped from Muscles' bottom straight through Lungs, so a correct
 * flow read as blood going from the muscles to the lungs.
 */
const SOL = {
  kind: "flow",
  alt: "Blood moves from heart to muscles, back to heart, to lungs, and back to heart.",
  layout: "graph",
  steps: [{ label: "Heart" }, { label: "Muscles" }, { label: "Lungs" }],
  links: [
    { from: 0, to: 1, label: "delivery" },
    { from: 1, to: 0, label: "return" },
    { from: 0, to: 2, label: "to lungs" },
    { from: 2, to: 0, label: "return" },
  ],
};

type R = { x0: number; y0: number; x1: number; y1: number };
type Pt = [number, number];

const num = (s: string, k: string) => Number(new RegExp(`${k}="(-?[\\d.]+)"`).exec(s)?.[1] ?? NaN);

/** The drawing read back from its SVG: boxes, link words (the haloed text) and every line. */
function readBack(svg: string) {
  const boxes: R[] = [...svg.matchAll(/<rect [^>]*>/g)].map(([r]) => {
    const x = num(r, "x");
    const y = num(r, "y");
    return { x0: x, y0: y, x1: x + num(r, "width"), y1: y + num(r, "height") };
  });
  const words: { t: string; r: R }[] = [];
  for (const [, attrs, body] of svg.matchAll(/<text ([^>]*)>(.*?)<\/text>/g)) {
    if (!attrs?.includes("stroke=")) continue; // box names have no halo
    const fs = num(attrs, "font-size");
    const anchor = /text-anchor="(\w+)"/.exec(attrs)?.[1] ?? "start";
    for (const [, tx, ty, t] of (body ?? "").matchAll(
      /<tspan x="([\d.-]+)" y="([\d.-]+)"[^>]*>([^<]*)<\/tspan>/g,
    )) {
      const w = (t ?? "").length * fs * 0.5;
      const x = Number(tx);
      const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
      words.push({
        t: t ?? "",
        r: { x0, x1: x0 + w, y0: Number(ty) - fs * 0.8, y1: Number(ty) + fs * 0.25 },
      });
    }
  }
  const lines: Pt[][] = [...svg.matchAll(/<line [^>]*>/g)].map(([l]) => [
    [num(l, "x1"), num(l, "y1")],
    [num(l, "x2"), num(l, "y2")],
  ]);
  // Curves (links back, loops), sampled.
  for (const [, d] of svg.matchAll(/<path d="([^"]+)"/g)) {
    const v = (d ?? "").match(/-?[\d.]+/g)?.map(Number) ?? [];
    const cp: Pt[] = [];
    for (let i = 0; i + 1 < v.length; i += 2) cp.push([v[i] as number, v[i + 1] as number]);
    if (!/[QC]/.test(d ?? "")) {
      lines.push(cp);
      continue;
    }
    const pts: Pt[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      let p = cp;
      while (p.length > 1)
        p = p.slice(1).map((q, j) => {
          const o = p[j] as Pt;
          return [o[0] + (q[0] - o[0]) * t, o[1] + (q[1] - o[1]) * t] as Pt;
        });
      pts.push(p[0] as Pt);
    }
    lines.push(pts);
  }
  return { boxes, words, lines };
}

/** Points along every line that stand inside a box (2 px in from its edge): a line through it. */
const throughBoxes = (svg: string) => {
  const { boxes, lines } = readBack(svg);
  const bad: string[] = [];
  for (const pts of lines)
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1] as Pt, pts[i] as Pt];
      for (let s = 0; s <= 8; s++) {
        const px = a[0] + ((b[0] - a[0]) * s) / 8;
        const py = a[1] + ((b[1] - a[1]) * s) / 8;
        for (const r of boxes)
          if (px > r.x0 + 2 && px < r.x1 - 2 && py > r.y0 + 2 && py < r.y1 - 2)
            bad.push(
              `${px.toFixed(0)},${py.toFixed(0)} in box at ${r.x0.toFixed(0)},${r.y0.toFixed(0)}`,
            );
      }
    }
  return bad;
};

/** Pairs of link words nearer than `gap` (one over the other, or end to end), as text. */
const crowded = (svg: string, gap: number) => {
  const { words } = readBack(svg);
  const bad: string[] = [];
  words.forEach((a, i) => {
    words.forEach((b, j) => {
      if (j <= i) return;
      const xGap = Math.max(a.r.x0, b.r.x0) - Math.min(a.r.x1, b.r.x1);
      const yGap = Math.max(a.r.y0, b.r.y0) - Math.min(a.r.y1, b.r.y1);
      if (xGap < gap && yGap < gap) bad.push(`"${a.t}" / "${b.t}"`);
    });
  });
  return bad;
};

const SPLASH = getTheme("splash", "ks2");
/** Sol's slide: the element rect and label size the stage settled on. */
const solSvg = () => {
  const e = diagramElement(SOL, SPLASH, { x: 86, y: 182, w: 788, h: 229, fs: 25 }, () => "d");
  return decodeURIComponent((e?.src ?? "").replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
};

describe("TEACH-247 ac: flow graph words and links back", () => {
  test("Sol's slide draws", () => {
    expect(solSvg()).toContain("Muscles");
  });
  test("Sol's slide: no link runs through a box", () => {
    expect(throughBoxes(solSvg())).toEqual([]);
  });
  test("Sol's slide: no two link words touch or stack into one phrase", () => {
    // A clear gap of half the word size: "delivery" over "to lungs" sat 11 px apart at 25 px.
    expect(crowded(solSvg(), 25 * 0.5)).toEqual([]);
  });
  test("Sol's flow in every slide zone: no link through a box, no words crowded", () => {
    for (const z of [
      { w: 716, h: 208 },
      { w: 788, h: 235 },
      { w: 403, h: 336 },
      { w: 300, h: 420 },
      { w: 860, h: 380 },
    ]) {
      const svg = renderDiagram(SOL, SPLASH, z) ?? "";
      if (!svg) continue;
      const fs = num(/<text [^>]*stroke=[^>]*>/.exec(svg)?.[0] ?? "", "font-size");
      expect([z, throughBoxes(svg)]).toEqual([z, []]);
      expect([z, crowded(svg, fs * 0.5)]).toEqual([z, []]);
    }
  });

  // Generated: one box fanning out to two to four others that each link back (Sol's shape, wider),
  // a fan-in, and a chain with two links back from stacked boxes.
  const fan = (k: number, back: boolean): Record<string, unknown> => ({
    kind: "flow",
    alt: "x",
    layout: "graph",
    steps: [{ label: "Hub" }, ...Array.from({ length: k }, (_, i) => ({ label: `Part ${i + 1}` }))],
    links: Array.from({ length: k }, (_, i) => [
      { from: 0, to: i + 1, label: `go ${i + 1}` },
      ...(back ? [{ from: i + 1, to: 0, label: `back ${i + 1}` }] : []),
    ]).flat(),
  });
  const cases: Record<string, Record<string, unknown>> = {
    "fan of 2 with links back": fan(2, true),
    "fan of 3 with links back": fan(3, true),
    "fan of 2, no links back": fan(2, false),
    "fan in": {
      kind: "flow",
      alt: "x",
      layout: "graph",
      steps: [{ label: "Sun" }, { label: "Rain" }, { label: "Plant" }],
      links: [
        { from: 0, to: 2, label: "light" },
        { from: 1, to: 2, label: "water" },
        { from: 2, to: 0, label: "reaches" },
      ],
    },
    "branch, both cases back to the start": {
      kind: "flow",
      alt: "x",
      layout: "graph",
      steps: [{ label: "Start" }, { label: "Test" }, { label: "Pass" }, { label: "Fail" }],
      links: [
        { from: 0, to: 1, label: "try" },
        { from: 1, to: 2, label: "yes" },
        { from: 1, to: 3, label: "no" },
        { from: 2, to: 0, label: "next" },
        { from: 3, to: 0, label: "again" },
      ],
    },
  };
  const zones = [
    { w: 716, h: 208 },
    { w: 860, h: 380 },
    { w: 403, h: 336 },
    { w: 300, h: 420 },
  ];
  for (const [name, spec] of Object.entries(cases))
    test(`${name}: no link through a box; words never overlap`, () => {
      let drawn = 0;
      for (const theme of [SPLASH, getTheme("studio", "ks4")])
        for (const z of zones) {
          const svg = renderDiagram(spec, theme, z) ?? "";
          if (!svg) continue;
          drawn++;
          expect([name, z, throughBoxes(svg)]).toEqual([name, z, []]);
          expect([name, z, crowded(svg, 0)]).toEqual([name, z, []]);
        }
      expect(drawn).toBeGreaterThan(0);
    });
  test("Sol's shape, wider: the fanned words stand a clear gap apart in a wide zone", () => {
    for (const k of [2, 3]) {
      const svg = renderDiagram(fan(k, true), SPLASH, { w: 860, h: 380 }) ?? "";
      const fs = num(/<text [^>]*stroke=[^>]*>/.exec(svg)?.[0] ?? "", "font-size");
      expect(svg).not.toBe("");
      expect([k, crowded(svg, fs * 0.5)]).toEqual([k, []]);
    }
  });
});
