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
  const shaftD = svg.match(/class="ashaft" d="([^"]+)"/)?.[1];
  const h = svg.match(/class="ahead" data-tip="([^"]+)" data-dir="([^"]+)" d="([^"]+)"/);
  expect(shaftD).toBeDefined();
  expect(h).not.toBeNull();
  return { shaftD: shaftD!, head: headFromAttrs(h![1]!, h![2]!, h![3]!) };
}

/** Every rule for one drawn arrow: tip under the shaft end, symmetric arms, nothing past the tip. */
function expectClean(a: Arrow, sw: number, past = 0.02) {
  const { shaftD, head } = readSvg(a.svg);
  const end = pathEnd(shaftD)!.tip;
  // 1. The shaft ends under the head: its end point is the tip, within the build check's 0.5px.
  expect(arrowFaults(head, end)).toEqual([]);
  expect(Math.hypot(end[0] - head.tip[0], end[1] - head.tip[1])).toBeLessThanOrEqual(0.02);
  // 2. The arms: ±32° about the shaft, each 3.2 × the stroke.
  const [ux, uy] = head.dir;
  const tipProj = head.tip[0] * ux + head.tip[1] * uy;
  for (const arm of head.arms) {
    const vx = arm[0] - head.tip[0];
    const vy = arm[1] - head.tip[1];
    const len = Math.hypot(vx, vy);
    expect(len).toBeCloseTo(sw * ARROW_ARM_K, 1);
    const deg = (Math.acos(-(vx * ux + vy * uy) / len) * 180) / Math.PI;
    expect(Math.abs(deg - ARROW_ARM_DEG)).toBeLessThanOrEqual(0.5);
    // the arms sit behind the tip
    expect(arm[0] * ux + arm[1] * uy).toBeLessThan(tipProj);
  }
  // 3. Nothing pokes past the tip: the shaft near the head never goes beyond it, and its round cap
  //    reaches no further than the head's own round join at the tip.
  const reach = sw * ARROW_ARM_K;
  // the shaft's last run inside the head's reach (walking back from the end until it leaves)
  const all = samplePath(shaftD, 256);
  const pts: Pt[] = [];
  for (let k = all.length - 1; k >= 0; k--) {
    const p = all[k]!;
    if (Math.hypot(p[0] - head.tip[0], p[1] - head.tip[1]) > reach) break;
    pts.push(p);
  }
  expect(pts.length).toBeGreaterThan(0);
  for (const p of pts) expect(p[0] * ux + p[1] * uy).toBeLessThanOrEqual(tipProj + past);
  const capReach = Math.max(...pts.map((p) => p[0] * ux + p[1] * uy)) + sw / 2;
  expect(capReach).toBeLessThanOrEqual(tipProj + sw / 2 + past);
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
          expectClean(arrowLine(a, polar(a, deg, len), { ink: "#000", sw }), sw);
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
      expectClean(arrowCubic(p0, c1, c2, p1, { ink: "var(--ink)", sw }), sw, 0.05);
      expectClean(arrowQuad(p0, ctl(0.2, 0.8), p1, { ink: "var(--ink)", sw }), sw, 0.05);
    }
  });

  test("a curve whose last control point sits on the tip still points along the curve", () => {
    const a = arrowCubic([0, 0], [100, 0], [200, 100], [200, 100], { ink: "#000", sw: 4 });
    expectClean(a, 4);
    // the head follows where the shaft comes from: down and to the right
    expect(a.head.dir[0]).toBeGreaterThan(0.6);
    expect(a.head.dir[1]).toBeGreaterThan(0.6);
  });

  test("an arrow along any path (lines, curves, H/V) takes its head from the last segment", () => {
    const a = arrowPath("M10 10 L200 10 Q260 10 260 80 V200 H120", { ink: "#000", sw: 5 })!;
    expectClean(a, 5, 0.02);
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

  test("the water cycle's dotted vapour arrow: a dot under the head, no gap", () => {
    const vapour = arrowCubic([860, 536], [860, 420], [790, 304], [694, 268], {
      ink: "var(--vapour)",
      sw: 7,
      dash: "0.1 18",
    });
    expectClean(vapour, 7);
    const off = Number(vapour.svg.match(/stroke-dashoffset="([^"]+)"/)?.[1]);
    const L = pathLength(vapour.shaft);
    expect(on(L - 0.05, 0.1, 18, off)).toBe(true);
    // the old drawing (no offset) left most of a period of empty shaft before the head
    expect(on(L - 0.05, 0.1, 18, 0)).toBe(false);
  });
});

describe("diagram arrows use the primitive", () => {
  test("svg.ts arrow(): every angle and stroke is clean", () => {
    for (const deg of ANGLES)
      for (const sw of [1.5, 2, 2.5, 3]) {
        const b = polar([300, 300], deg, 120);
        const svg = diagramArrow(300, 300, b[0], b[1], "#123", sw);
        const { shaftD, head } = readSvg(svg);
        expect(arrowFaults(head, pathEnd(shaftD)!.tip)).toEqual([]);
        expect(Math.hypot(head.tip[0] - b[0], head.tip[1] - b[1])).toBeLessThan(0.01);
      }
  });
});
