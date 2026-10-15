import { describe, expect, test } from "bun:test";
import { arrow as diagramArrow } from "../diagrams/svg";
import {
  ARROW_ARM_DEG,
  ARROW_ARM_K,
  type Arrow,
  arrowCubic,
  arrowFaults,
  arrowHead,
  arrowLine,
  arrowPath,
  arrowQuad,
  endDashOffset,
  headFromAttrs,
  type Pt,
  pathEnd,
  pathLength,
  samplePath,
} from "./arrow";

const ANGLES = Array.from({ length: 72 }, (_, i) => i * 5 + 0.37); // every 5°, off the axes
const STROKES = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 9, 12];
const LENGTHS = [6, 24, 90, 400];

/** Read the drawn arrow back from its SVG string, as the browser check does. */
function readSvg(svg: string) {
  const sh = svg.match(/class="ashaft" d="([^"]+)" data-end="([^"]+)"/);
  const h = svg.match(/class="ahead" data-tip="([^"]+)" data-dir="([^"]+)" d="([^"]+)"/);
  const dash = svg.match(/stroke-dasharray="([\d.]+) ([\d.]+)" stroke-dashoffset="([-\d.]+)"/);
  if (!sh || !h) throw new Error("no arrow in svg");
  return {
    shaftD: sh[1] as string,
    end: (sh[2] as string).split(",").map(Number) as unknown as Pt,
    head: headFromAttrs(h[1] as string, h[2] as string, h[3] as string),
    dash: dash ? dash.slice(1).map(Number) : undefined,
  };
}

/** The chord the head must aim along: from the line's point 1.5 head-lengths back to the tip. */
function chordDir(line: string, tip: Pt, sw: number): Pt {
  const reach = sw * ARROW_ARM_K * 1.5;
  const pts = samplePath(line, 2048);
  let from = pts[0] as Pt;
  for (let k = pts.length - 1; k >= 0; k--) {
    const p = pts[k] as Pt;
    if (Math.hypot(p[0] - tip[0], p[1] - tip[1]) >= reach) {
      from = p;
      break;
    }
  }
  const L = Math.hypot(tip[0] - from[0], tip[1] - from[1]);
  return [(tip[0] - from[0]) / L, (tip[1] - from[1]) / L];
}

/** Points of the shaft that carry paint, with their distance along it. */
function paintedPoints(shaftD: string, dash?: number[]): Pt[] {
  const pts = samplePath(shaftD, 512);
  const out: Pt[] = [];
  let s = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k] as Pt;
    if (k) s += Math.hypot(p[0] - (pts[k - 1] as Pt)[0], p[1] - (pts[k - 1] as Pt)[1]);
    if (!dash) out.push(p);
    else {
      const [on, off, o] = dash as [number, number, number];
      const P = on + off;
      if ((((s + o) % P) + P) % P < on + 0.01) out.push(p);
    }
  }
  return out;
}

/**
 * Every rule for one drawn arrow along `line`: the line ends at the tip; the head is symmetric
 * about the end chord; no shaft paint sits inside the head's V (a solid shaft only along its axis,
 * a dashed one stopping a clear stroke before the head's ink); nothing pokes past the tip.
 */
function expectClean(line: string, a: Arrow, sw: number) {
  const { shaftD, end, head, dash } = readSvg(a.svg);
  expect(arrowFaults(head, end)).toEqual([]);
  const tip = head.tip;
  // the head is symmetric, within 2°, about the chord the line arrives along
  const [cx, cy] = chordDir(line, tip, sw);
  for (const arm of head.arms) {
    const vx = arm[0] - tip[0];
    const vy = arm[1] - tip[1];
    const len = Math.hypot(vx, vy);
    expect(len).toBeCloseTo(sw * ARROW_ARM_K, 1);
    const deg = (Math.acos(-(vx * cx + vy * cy) / len) * 180) / Math.PI;
    expect(Math.abs(deg - ARROW_ARM_DEG)).toBeLessThanOrEqual(2);
  }
  const [ux, uy] = head.dir;
  const along = (p: Pt) => (p[0] - tip[0]) * ux + (p[1] - tip[1]) * uy;
  const across = (p: Pt) => Math.abs(-(p[0] - tip[0]) * uy + (p[1] - tip[1]) * ux);
  const depth = sw * ARROW_ARM_K * Math.cos((ARROW_ARM_DEG * Math.PI) / 180);
  const near = sw * ARROW_ARM_K * 1.5;
  for (const p of paintedPoints(shaftD, dash)) {
    // the paint around the head (earlier turns of a long path may lie anywhere)
    if (Math.hypot(p[0] - tip[0], p[1] - tip[1]) > near) continue;
    // never past the tip
    expect(along(p)).toBeLessThanOrEqual(0.02);
    if (dash) {
      // a dash or dot ends a clear stroke before the head's ink: its own ink (sw/2) and the arms'
      // (sw/2) never come within one stroke of each other
      expect(along(p)).toBeLessThanOrEqual(-depth - 2 * sw + 0.05);
    } else if (along(p) > -depth) {
      // inside the V, a solid shaft runs only straight along the head's axis
      expect(across(p)).toBeLessThanOrEqual(0.05);
    }
  }
}

const polar = (o: Pt, deg: number, r: number): Pt => [
  o[0] + Math.cos((deg * Math.PI) / 180) * r,
  o[1] + Math.sin((deg * Math.PI) / 180) * r,
];

describe("arrow primitive: the shaft ends under the head at any angle", () => {
  test("straight arrows, 72 angles × 11 strokes × 4 lengths", () => {
    let n = 0;
    for (const deg of ANGLES)
      for (const sw of STROKES)
        for (const len of LENGTHS) {
          const a: Pt = [700, 400];
          const b = polar(a, deg, len);
          const r = (p: Pt) => p.map((v) => Math.round(v * 100) / 100);
          expectClean(
            `M${r(a).join(" ")} L${r(b).join(" ")}`,
            arrowLine(a, b, { ink: "#000", sw }),
            sw,
          );
          n++;
        }
    expect(n).toBe(72 * 11 * 4);
  });

  test("cubic and quadratic arrows end on their curve's tangent, any bend", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    // bowed connectors as diagrams draw them: controls inside the band beside the chord, any
    // direction, any bow either side, short to long
    for (let k = 0; k < 600; k++) {
      const sw = STROKES[k % STROKES.length]!;
      const p0: Pt = [rnd() * 1400, rnd() * 800];
      const L = 4 * sw * ARROW_ARM_K + rnd() * 600;
      const p1 = polar(p0, rnd() * 360, L);
      const ux = (p1[0] - p0[0]) / L;
      const uy = (p1[1] - p0[1]) / L;
      const ctl = (lo: number, hi: number): Pt => {
        const t = lo + rnd() * (hi - lo);
        const o = (rnd() * 1.2 - 0.6) * L;
        return [p0[0] + ux * t * L - uy * o, p0[1] + uy * t * L + ux * o];
      };
      const c1 = ctl(0.1, 0.5);
      const c2 = ctl(0.5, 0.9);
      const q = ctl(0.2, 0.8);
      const r = (p: Pt) => p.map((v) => Math.round(v * 100) / 100).join(" ");
      for (const dash of [undefined, "0.1 16", "10 9"]) {
        expectClean(
          `M${r(p0)} C${r(c1)} ${r(c2)} ${r(p1)}`,
          arrowCubic(p0, c1, c2, p1, { ink: "var(--ink)", sw, dash }),
          sw,
        );
        expectClean(
          `M${r(p0)} Q${r(q)} ${r(p1)}`,
          arrowQuad(p0, q, p1, { ink: "var(--ink)", sw, dash }),
          sw,
        );
      }
    }
  });

  test("a curve whose last control point sits on the tip still points along the curve", () => {
    const a = arrowCubic([0, 0], [100, 0], [200, 100], [200, 100], { ink: "#000", sw: 4 });
    expectClean("M0 0 C100 0 200 100 200 100", a, 4);
    // the head follows where the shaft comes from: down and to the right
    expect(a.head.dir[0]).toBeGreaterThan(0.6);
    expect(a.head.dir[1]).toBeGreaterThan(0.6);
  });

  test("an arrow along any path (lines, curves, H/V) takes its head from the last segment", () => {
    const line = "M10 10 L200 10 Q260 10 260 80 V200 H120";
    const a = arrowPath(line, { ink: "#000", sw: 5 }) as Arrow;
    expectClean(line, a, 5);
    expect(a.head.dir[0]).toBeCloseTo(-1, 5);
  });

  test("the head shares the shaft's stroke, caps and joins, and draws no second head", () => {
    const { svg } = arrowLine([0, 0], [100, 50], { ink: "var(--accent)", sw: 6 });
    expect(svg.match(/class="ahead"/g)).toHaveLength(1);
    expect(svg.match(/stroke-linecap="round"/g)).toHaveLength(2);
    expect(svg.match(/stroke-linejoin="round"/g)).toHaveLength(2);
    expect(svg.match(/stroke-width="6"/g)).toHaveLength(2);
    expect(svg).not.toContain("<polygon");
  });

  test("the check catches the old shortened shaft and an asymmetric head", () => {
    const h = arrowHead([100, 100], [0, 100], 4);
    expect(arrowFaults(h, [96, 100])).toEqual(["arrow: shaft end not under head tip"]);
    const lopsided = { ...h, arms: [h.arms[0], [h.arms[1][0] + 2, h.arms[1][1]]] as [Pt, Pt] };
    expect(arrowFaults(lopsided, [100, 100])).toEqual([
      "arrow: head arms not symmetric about the shaft",
    ]);
  });
});

describe("arrow primitive: dashed and dotted shafts end with a dash under the head", () => {
  /** Is the pattern drawing at distance s along the path? */
  const on = (s: number, dash: number, gap: number, off: number) => {
    const P = dash + gap;
    return (((s + off) % P) + P) % P < dash;
  };

  test("the last dash or dot finishes exactly at the shaft's end, for any length", () => {
    for (const [dash, gap] of [
      [0.1, 18],
      [10, 9],
      [10, 8],
      [2, 6],
    ] as const)
      for (let L = 1; L < 600; L += 3.7) {
        const off = endDashOffset(L, dash, gap);
        // drawn just before the end, and the end is where that dash stops
        expect(on(L - Math.min(dash, 0.05) / 2, dash, gap, off)).toBe(true);
        const P = dash + gap;
        const phase = (((L + off) % P) + P) % P;
        expect(Math.min(Math.abs(phase - dash), Math.abs(phase - dash - P))).toBeLessThan(0.002);
      }
  });

  test("the water cycle's dotted vapour and transpiration arrows: a clear gap, a straight head", () => {
    const vapour = "M860 536 C860 420 790 304 694 268";
    expectClean(
      vapour,
      arrowPath(vapour, { ink: "var(--vapour)", sw: 6, dash: "0.1 16" }) as Arrow,
      6,
    );
    // transpiration: a short S that leaves a leaf straight up (the skewed-head case)
    const leaf = "M64 538 C52 514 76 492 64 468";
    expectClean(leaf, arrowPath(leaf, { ink: "var(--vapour)", sw: 6, dash: "0.1 16" }) as Arrow, 6);
  });
});

describe("diagram arrows use the primitive", () => {
  test("svg.ts arrow(): every angle and stroke is clean", () => {
    for (const deg of ANGLES)
      for (const sw of [1.5, 2, 2.5, 3]) {
        const b = polar([300, 300], deg, 120);
        const svg = diagramArrow(300, 300, b[0], b[1], "#123", sw);
        expectClean(
          `M300 300 L${b.map((v) => Math.round(v * 100) / 100).join(" ")}`,
          { svg } as Arrow,
          sw,
        );
        const { head } = readSvg(svg);
        expect(Math.hypot(head.tip[0] - b[0], head.tip[1] - b[1])).toBeLessThan(0.01);
      }
  });
});
