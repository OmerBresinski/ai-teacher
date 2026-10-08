/**
 * Hand-built templates for the commonest teaching diagrams (round I). The writer picks a template
 * and fills small typed slots; every position, size and label placement here is code's, so the
 * figure draws cleanly on every theme and slot. Each draws into `w`×`h` slide points.
 */

import { finishOf } from "./finish";
import { timeOf } from "./meaning";
import {
  addLine,
  type Box,
  blockSize,
  drawBlock,
  drawKey,
  fitLines,
  type LabelReq,
  overlaps,
  placeAll,
  placeFirst,
  placeLabel,
  type Scene,
  scene,
} from "./place";
import { nodeFill, polishNodes, snug } from "./polish";
import type { Cycle, Hydrograph, Layers, Particles, River, Timeline } from "./schema";
import { look, STROKE, sub, TYPE_FLOOR, WEIGHT } from "./style";
import {
  arrow,
  arrowHead,
  type Ctx,
  hBrace,
  mix,
  n,
  niceTop,
  num,
  text,
  textWidth,
  ticks,
} from "./svg";

type Pt = [number, number];

const bad = (x: Ctx, why: string) => {
  x.faults?.push(why);
};

/** The largest size from `x.fs` down to the type floor at which every text fits; the floor otherwise. */
function sizeFor(x: Ctx, ok: (fs: number) => boolean): number {
  for (let fs = x.fs; fs >= TYPE_FLOOR; fs -= 1) if (ok(fs)) return fs;
  return TYPE_FLOOR;
}

// ─── particles ──────────────────────────────────────────────────────────────────────────────

/** Particle centres in a unit box (radius R), side 1. */
const R = 0.09;
// DIAGRAM-AUDIT guard: every state panel holds the same 12 particles, so a states row with
// "melting" and "boiling" arrows never shows particles vanishing (it drew 20, 13 and 7).
/** A solid: a regular 4 × 3 block of touching particles on the floor of the box. */
const SOLID: Pt[] = (() => {
  const out: Pt[] = [];
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 4; i++) out.push([0.5 - 3 * R + i * 2 * R, 0.95 - R - j * 2 * R]);
  return out;
})();
/** A liquid: touching but irregular, filling the bottom of the box. */
const LIQUID: Pt[] = [
  [0.14, 0.86],
  [0.33, 0.86],
  [0.52, 0.865],
  [0.7, 0.86],
  [0.88, 0.855],
  [0.22, 0.695],
  [0.41, 0.695],
  [0.61, 0.7],
  [0.8, 0.695],
  [0.13, 0.535],
  [0.32, 0.52],
  [0.53, 0.535],
];
/** Spread positions for two substances mixing (four columns of three). */
const MIX: Pt[] = [
  [0.13, 0.17],
  [0.14, 0.5],
  [0.12, 0.83],
  [0.37, 0.28],
  [0.38, 0.62],
  [0.36, 0.88],
  [0.63, 0.13],
  [0.62, 0.45],
  [0.64, 0.78],
  [0.87, 0.25],
  [0.86, 0.57],
  [0.88, 0.87],
];
/** A gas: the same 12 particles spread far apart through the whole box. */
const GAS: Pt[] = MIX;
/** Movement marks: [particle index, dx, dy] per state. */
const MOVES: Record<string, [number, number, number][]> = {
  liquid: [
    [10, 0.7, -0.7],
    [11, 1, 0],
    [6, -0.6, -0.8],
  ],
  gas: [
    [0, 1, 0.3],
    [1, -0.8, 0.6],
    [3, 0.7, -0.7],
    [4, 0.9, 0.4],
    [5, -0.9, -0.3],
  ],
};

type Panel = {
  dots: { at: Pt; second?: boolean }[];
  state?: "solid" | "liquid" | "gas";
  /** dd-diagrams2 compare: the container's side as a share of the panel (a compressed gas). */
  room?: number;
  speed?: "slow" | "fast";
  energy?: number;
  /** dd-diagrams2 collision: what happens after the two particles meet. */
  outcome?: "bounces" | "reacts";
  /** Round 8: a solid lump on the floor; the particles stand above it. */
  solid?: boolean;
  /** Round 8: a squashed gas: a piston arrow pushes the lid in. */
  squash?: boolean;
};

/** Round 8: the share of a panel's height a solid lump takes on its floor. */
const LUMP = 0.26;

/** `k` particle centres for a state in a unit box, deterministic (dd-diagrams2 compare). */
function scatter(state: "solid" | "liquid" | "gas", k: number): Pt[] {
  if (state !== "gas") {
    const cols = state === "liquid" ? 4 : k > 9 ? 5 : Math.max(3, Math.ceil(Math.sqrt(k * 1.4)));
    const out: Pt[] = [];
    for (let i = 0; i < k; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      // A liquid: alternate rows shifted half a particle, a little play, never overlapping.
      const jx = state === "liquid" ? (((i * 37) % 7) / 7 - 0.5) * 0.15 : 0;
      const shift = state === "liquid" && row % 2 ? R * 0.9 : 0;
      out.push([
        Math.min(
          1 - R * 1.1,
          Math.max(R * 1.1, 0.5 + (col - (cols - 1) / 2) * 2.05 * R + jx * R + shift),
        ),
        0.95 - R - row * 2 * R,
      ]);
    }
    return out;
  }
  // A gas: a jittered grid over the whole box, every particle well apart.
  const cols = Math.ceil(Math.sqrt(k));
  const rows = Math.ceil(k / cols);
  const out: Pt[] = [];
  for (let i = 0; i < k; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const jx = (((i * 7919) % 13) / 13 - 0.5) * 0.15;
    const jy = (((i * 104729) % 11) / 11 - 0.5) * 0.15;
    out.push([
      R * 1.3 + ((c + 0.5 + jx) / cols) * (1 - 2.6 * R),
      R * 1.3 + ((r + 0.5 + jy) / rows) * (1 - 2.6 * R),
    ]);
  }
  return out;
}

/**
 * `k` particle centres (radius `r`, unit box) round a lump: about half of them (at least one)
 * resting on its top or against its sides, the rest on a staggered grid through the liquid above,
 * every pair at least a particle apart, deterministic.
 */
function roundLump(
  k: number,
  r: number,
  lump: { x0: number; y0: number; x1: number; y1: number },
): Pt[] {
  const d = 2 * r * 1.08;
  const on: Pt[] = [];
  // The lump's top, centre outwards, then its two sides on the floor.
  const topY = lump.y0 - r - 0.004;
  const mid = (lump.x0 + lump.x1) / 2;
  const across = Math.max(1, Math.floor((lump.x1 - lump.x0) / d));
  for (let i = 0; i < across; i++) {
    const o = Math.ceil(i / 2) * (i % 2 ? -1 : 1);
    on.push([mid + (o + (across % 2 ? 0 : 0.5)) * d, topY]);
  }
  const sideY = Math.min(lump.y1 - r, 1 - r - 0.01);
  on.splice(1, 0, [lump.x0 - r - 0.004, sideY], [lump.x1 + r + 0.004, sideY]);
  const touching = Math.min(on.length, Math.max(1, Math.round(k / 2)));
  const out: Pt[] = on.slice(0, touching);
  const clear = (p: Pt) => out.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= d);
  // The liquid: a fine grid of candidate spots clear of the walls and of the lump (and of the
  // particles touching it); the spacing comes from the pick below, not the grid.
  const free: Pt[] = [];
  const near = (p: Pt) => {
    const dx = Math.max(lump.x0 - p[0], 0, p[0] - lump.x1);
    const dy = Math.max(lump.y0 - p[1], 0, p[1] - lump.y1);
    return Math.hypot(dx, dy) < r * 1.05;
  };
  for (let y = r * 1.15; y <= 1 - r - 0.01; y += d / 3)
    for (let px = r * 1.15; px <= 1 - r * 1.15; px += d / 3) if (!near([px, y])) free.push([px, y]);
  // Each next particle takes the free spot furthest from those placed (spread, not a clump).
  const left = free.filter(clear);
  while (out.length < k && left.length) {
    let best = 0;
    let far = -1;
    left.forEach((p, i) => {
      const dmin = Math.min(...out.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
      if (dmin > far + 1e-9) {
        far = dmin;
        best = i;
      }
    });
    const [p] = left.splice(best, 1);
    if (p && clear(p)) out.push(p);
  }
  for (const p of on.slice(touching)) if (out.length < k && clear(p)) out.push(p);
  while (out.length < k) out.push(out[out.length - 1] ?? [0.5, 0.5]);
  return out;
}

function panels(s: Particles): Panel[] {
  const one = (p: Pt) => ({ at: p });
  if (s.show === "compare" && s.panels) {
    return s.panels.map((q) => ({
      state: q.state,
      room: q.room === "small" ? 0.62 : 1,
      speed: q.speed,
      energy: q.energy,
      solid: q.solid,
      squash: q.squash,
      // The second kind is spread through the first (a solution), not stacked on top of it.
      dots: scatter(q.state, q.count + q.extra).map((at, i, all) => ({
        at,
        second:
          Math.floor(((i + 1) * q.extra) / all.length) > Math.floor((i * q.extra) / all.length),
      })),
    }));
  }
  if (s.show === "collision" && s.outcomes) {
    return s.outcomes.map((o) => ({ outcome: o, dots: [] }));
  }
  if (s.show === "states") {
    return s.states.map((st) => ({
      state: st,
      dots: (st === "solid" ? SOLID : st === "liquid" ? LIQUID : GAS).map(one),
    }));
  }
  if (s.show === "diffusion") {
    return [
      { dots: MIX.map((p, i) => ({ at: p, second: i >= 6 })) },
      { dots: MIX.map((p, i) => ({ at: p, second: (Math.floor(i / 3) + (i % 3)) % 2 === 1 })) },
    ];
  }
  // Dissolving: the solute's particles together in a lump, then spread through the liquid.
  const lump = new Set([1, 2, 6, 7]);
  const spread = new Set([0, 4, 8, 11]);
  const before = LIQUID.map((p, i) => ({ at: p, second: lump.has(i) }));
  const after = LIQUID.map((p, i) => ({ at: p, second: spread.has(i) }));
  return [{ dots: before }, { dots: after }];
}

// The modern looks' drawing inset (DRAW_INSET) already keeps the panels off the edges.
const panelInset = () => 0;

export function drawParticles(s: Particles, x: Ctx, w: number, h: number): string {
  const ps = panels(s);
  const k = ps.length;
  const cap = (i: number) =>
    s.captions?.[i] ??
    (s.show === "collision"
      ? ps[i]?.outcome === "reacts"
        ? "Reaction"
        : "No reaction"
      : s.show === "states" || s.show === "compare"
        ? (ps[i]?.state ?? "").replace(/^./, (c) => c.toUpperCase())
        : i === 0
          ? "Before"
          : "After");
  const note = (i: number) =>
    s.notes?.[i] ??
    (s.show === "collision"
      ? ps[i]?.outcome === "reacts"
        ? "Product forms"
        : "Bounce apart, no product"
      : undefined);
  const arrowWord = (i: number) =>
    s.arrows?.[i] ??
    (s.show === "states" || s.show === "compare" || s.show === "collision" || s.captions?.length
      ? undefined
      : s.show === "diffusion"
        ? "spreads"
        : "dissolves");
  const hasArrows =
    (s.show !== "states" &&
      s.show !== "compare" &&
      s.show !== "collision" &&
      !s.captions?.length) ||
    (s.arrows?.length ?? 0) > 0;
  const key =
    s.key ??
    (s.show === "dissolving"
      ? (["Solvent", "Solute"] as [string, string])
      : s.show === "collision"
        ? (["Particle A", "Particle B"] as [string, string])
        : undefined);

  let layout:
    | {
        fs: number;
        gap: number;
        colW: number;
        side: number;
        capH: number;
        noteH: number;
        keyH: number;
        under: boolean;
        wordH: number;
      }
    | undefined;
  // dd-diagrams: state changes in a narrow zone (T y7 s8, s9: three panels and "Condensing" in a
  // half zone drew nothing). When the words do not fit between the panels, the panels close up
  // round short arrows and each word stands under its arrow, centred on the gap.
  for (const under of hasArrows && k > 1 ? [false, true] : [false])
    for (let fs = x.fs; fs >= TYPE_FLOOR && !layout; fs -= 1) {
      const gapWords = Array.from({ length: k - 1 }, (_, i) => arrowWord(i)).filter(
        Boolean,
      ) as string[];
      const gapText = Math.max(
        0,
        ...gapWords.flatMap((g) =>
          g.split(/\s+/).map((wd) => textWidth(wd, x, Math.max(TYPE_FLOOR, fs * 0.9), 600)),
        ),
      );
      if (layout) break;
      const gap = !hasArrows
        ? Math.max(w * 0.05, 14)
        : under
          ? Math.max(w * 0.06, 2 * fs)
          : Math.max(w * 0.09, gapText + 12, 2.2 * fs);
      // Modern looks: soft panels stand clear of the drawing's edge.
      const colW = (w - 2 * panelInset() - (k - 1) * gap) / k;
      const capLines = ps.map((_, i) => fitLines(x, cap(i), colW, 2, fs, 700));
      const noteLines = ps.map((_, i) =>
        note(i)
          ? fitLines(x, note(i) as string, colW, 3, Math.max(TYPE_FLOOR, fs * 0.9), WEIGHT.label)
          : [],
      );
      const wordRoom = under ? colW + gap - fs * 0.6 : gap - 6;
      const arrowLines = gapWords.map((g) =>
        fitLines(x, g, wordRoom, 2, Math.max(TYPE_FLOOR, fs * 0.9), 600),
      );
      if (capLines.some((l) => !l) || noteLines.some((l) => !l) || arrowLines.some((l) => !l))
        continue;
      const capH =
        Math.max(...capLines.map((l) => blockSize(x, l as string[], fs, 700).bh)) + 0.35 * fs;
      const nl = Math.max(0, ...noteLines.map((l) => (l as string[]).length));
      const noteH = nl
        ? blockSize(x, Array(nl).fill("x"), Math.max(TYPE_FLOOR, fs * 0.9), WEIGHT.label).bh +
          0.35 * fs
        : 0;
      // r3-diag: a key too wide for one row stacks its two entries (y11 r2 s5 "Other particles").
      const kf = Math.max(TYPE_FLOOR, fs * 0.9);
      const keyRow = key
        ? fs * 2.2 +
          textWidth(key[0], x, kf, WEIGHT.label) +
          textWidth(key[1], x, kf, WEIGHT.label) +
          36
        : 0;
      const keyH = key ? (keyRow <= w ? 1.6 : 2.9) * fs : 0;
      const wl = Math.max(0, ...arrowLines.map((l) => (l as string[]).length));
      const wordH =
        under && wl
          ? blockSize(x, Array(wl).fill("x"), Math.max(TYPE_FLOOR, fs * 0.9), 600).bh + 0.4 * fs
          : 0;
      const side = Math.min(colW, h - capH - noteH - keyH - wordH - 4);
      if (side < 4.5 * fs || side < 70) continue;
      layout = { fs, gap, colW, side, capH, noteH, keyH, under, wordH };
    }
  if (!layout) {
    bad(x, "the particle panels do not fit the space");
    return "";
  }
  const { fs, gap, colW, side, capH, noteH, keyH, under, wordH } = layout;
  const used = capH + side + noteH + keyH + wordH;
  const top = (h - used) / 2;
  const out: string[] = [];
  const boxY = top + capH;
  const r = R * side * 0.97;
  ps.forEach((p, i) => {
    const cx0 = panelInset() + i * (colW + gap);
    const bx = cx0 + (colW - side) / 2;
    const capLines = fitLines(x, cap(i), colW, 2, fs, 700) as string[];
    const cb = blockSize(x, capLines, fs, 700);
    out.push(
      drawBlock(
        x,
        {
          x0: cx0 + colW / 2 - cb.bw / 2,
          x1: cx0 + colW / 2 + cb.bw / 2,
          y0: top,
          y1: top + cb.bh,
        },
        capLines,
        fs,
        {
          weight: 700,
          fill: x.c.ink,
        },
      ),
    );
    // A container open at the top: three sides, an outline on the ground, never a filled panel
    // (rulings 160, 162).
    out.push(
      `<path d="M${n(bx)},${n(boxY)} L${n(bx)},${n(boxY + side)} L${n(bx + side)},${n(boxY + side)} L${n(bx + side)},${n(boxY)}" fill="none" stroke="${x.c.muted}" stroke-width="2.5" stroke-linejoin="round"/>`,
    );
    x.strokes?.push(
      [bx, boxY, bx, boxY + side],
      [bx, boxY + side, bx + side, boxY + side],
      [bx + side, boxY, bx + side, boxY + side],
    );
    // compare: a smaller container (a compressed gas) stands on the same floor, the same particles
    // inside it; particles keep their size.
    const room = p.room ?? 1;
    const ib = room < 1 ? side * room : side;
    const ix = bx + (side - ib) / 2;
    const iy = boxY + side - ib;
    if (room < 1)
      out.push(
        `<path d="M${n(ix)},${n(iy)} L${n(ix + ib)},${n(iy)}" stroke="${x.c.ink}" stroke-width="3" stroke-linecap="round"/>`,
      );
    // Every panel's particles are one size: the smallest container's.
    // A gas's grid cell bounds its particles too, so a crowded or compressed panel never overlaps.
    const rc = Math.min(
      r * Math.min(1, ...ps.map((q) => q.room ?? 1)),
      ...ps
        .filter((q) => q.room !== undefined && q.state === "gas")
        .map(
          (q) =>
            ((1 - 2.6 * R) / Math.ceil(Math.sqrt(q.dots.length))) * side * (q.room ?? 1) * 0.33,
        ),
    );
    const dotStart = out.length;
    if (p.solid) {
      // Round 8: the lump on the floor, as wide as half the container, its name set on it.
      const lh = ib * LUMP * 0.8;
      const lw = ib * 0.55;
      const lx = ix + (ib - lw) / 2;
      const ly = iy + ib - lh - 2;
      const ft = finishOf(x);
      out.push(
        `<rect x="${n(lx)}" y="${n(ly)}" width="${n(lw)}" height="${n(lh)}" rx="${n(lh * ft.radius.lump)}" fill="${mix(x.c.muted, x.c.bg, ft.wash.lump)}" stroke="${x.c.ink}" stroke-width="${ft.stroke.lump}"/>`,
      );
      x.strokes?.push([lx, ly, lx + lw, ly]);
      if (s.lump && i === 0) {
        const lf = Math.max(TYPE_FLOOR, Math.min(fs * 0.8, lh * 0.7));
        if (textWidth(s.lump, x, lf, WEIGHT.label) <= lw - 6)
          out.push(text(x, lx + lw / 2, ly + lh / 2, [s.lump], { fs: lf, fill: x.c.ink }));
        else bad(x, "the lump's name does not fit on it");
      }
      // The particles round the lump: some touching its surface (top and sides), the rest spread
      // through the liquid above it, none overlapping (BAKEOFF round 8: a clump, none at the surface).
      const at = roundLump(p.dots.length, rc / ib, {
        x0: (lx - ix) / ib,
        y0: (ly - iy) / ib,
        x1: (lx + lw - ix) / ib,
        y1: (ly + lh - iy) / ib,
      });
      p.dots.forEach((d, j) => {
        d.at = at[j] as Pt;
      });
    }
    if (p.squash) {
      // Round 8: the piston: a bar on the lowered lid and an arrow pushing down onto it.
      const a = Math.max(8, fs * 0.5);
      out.push(
        `<rect x="${n(ix + 2)}" y="${n(iy - 7)}" width="${n(ib - 4)}" height="6" rx="2" fill="${x.c.ink}"/>`,
        arrow(
          ix + ib / 2,
          Math.max(boxY - capH * 0.2, iy - (iy - boxY) * 0.95 - 2),
          ix + ib / 2,
          iy - 9,
          x.c.ink,
          3,
          a,
        ),
      );
    }
    for (const d of p.dots) {
      out.push(
        `<circle cx="${n(ix + d.at[0] * ib)}" cy="${n(iy + d.at[1] * ib)}" r="${n(rc)}" fill="${d.second ? x.c.accent2 : x.c.accent}" stroke="${x.c.ink}" stroke-width="${STROKE.hair}"/>`,
      );
    }
    if (p.outcome) {
      // Two particles meet (top), then bounce apart or join as a product (bottom).
      const cy1 = boxY + side * 0.3;
      const cy2 = boxY + side * 0.75;
      const cx = bx + side / 2;
      const rr = r * 1.15;
      const dot = (px: number, py: number, second: boolean) =>
        `<circle cx="${n(px)}" cy="${n(py)}" r="${n(rr)}" fill="${second ? x.c.accent2 : x.c.accent}" stroke="${x.c.ink}" stroke-width="${STROKE.hair}"/>`;
      const a = Math.max(6, rr * 0.7);
      out.push(
        dot(cx - side * 0.3, cy1, false),
        dot(cx + side * 0.3, cy1, true),
        arrow(cx - side * 0.3 + rr * 1.2, cy1, cx - rr * 0.6, cy1, x.c.ink, 2, a),
        arrow(cx + side * 0.3 - rr * 1.2, cy1, cx + rr * 0.6, cy1, x.c.ink, 2, a),
        arrow(cx, cy1 + rr * 1.4, cx, cy2 - rr * 1.6, x.c.muted, 2, a),
      );
      if (p.outcome === "reacts")
        // The product: the two particles joined by a bond, ringed as one new particle.
        out.push(
          `<ellipse cx="${n(cx)}" cy="${n(cy2)}" rx="${n(rr * 2.5)}" ry="${n(rr * 1.6)}" fill="none" stroke="${x.c.ink}" stroke-width="1.5" stroke-dasharray="4 3"/>`,
          dot(cx - rr * 0.95, cy2, false),
          dot(cx + rr * 0.95, cy2, true),
        );
      else
        out.push(
          dot(cx - side * 0.18, cy2, false),
          dot(cx + side * 0.18, cy2, true),
          arrow(cx - side * 0.18 - rr * 1.2, cy2, cx - side * 0.42, cy2, x.c.ink, 2, a),
          arrow(cx + side * 0.18 + rr * 1.2, cy2, cx + side * 0.42, cy2, x.c.ink, 2, a),
        );
    }
    // r4: how fast this panel's particles move, 0 to 1: its energy (temperature) against the
    // hottest panel's, else fast 1 and slow 0.3, else (motion only) 0.3. Every particle carries a
    // trail behind it and an arrow ahead, both as long as its speed, so a hotter panel visibly
    // moves faster with the same particles in the same box.
    const energies = ps.map((q) => q.energy).filter((e): e is number => e !== undefined);
    const hottest = Math.max(...energies, 0);
    const rel =
      p.energy !== undefined && hottest > 0
        ? Math.max(0.15, p.energy / hottest)
        : p.speed === "fast"
          ? 1
          : p.speed === "slow"
            ? 0.3
            : s.show === "compare" && s.motion
              ? 0.3
              : undefined;
    if (rel !== undefined && p.state !== "solid") {
      const L = rc * (0.5 + 3.4 * rel);
      const trails: string[] = [];
      p.dots.forEach((d, j) => {
        const ang = (j * 137.5 * Math.PI) / 180;
        const [dx, dy] = [Math.cos(ang), Math.sin(ang)];
        const cx0 = ix + d.at[0] * ib;
        const cy0 = iy + d.at[1] * ib;
        const clampX = (v: number) => Math.max(ix + rc, Math.min(ix + ib - rc, v));
        const clampY = (v: number) => Math.max(iy + rc, Math.min(iy + ib - rc, v));
        for (const [k, op] of [
          [0.55, 0.35],
          [1, 0.16],
        ] as const)
          trails.push(
            `<circle cx="${n(clampX(cx0 - dx * L * k))}" cy="${n(clampY(cy0 - dy * L * k))}" r="${n(rc * 0.85)}" fill="${d.second ? x.c.accent2 : x.c.accent}" fill-opacity="${op}"/>`,
          );
        const sx = cx0 + dx * rc * 1.1;
        const sy = cy0 + dy * rc * 1.1;
        const ex = clampX(sx + dx * L);
        const ey = clampY(sy + dy * L);
        if (Math.hypot(ex - sx, ey - sy) > rc * 0.4)
          out.push(arrow(sx, sy, ex, ey, x.c.ink, 1.5, Math.max(5, rc * 0.6)));
      });
      out.splice(dotStart, 0, ...trails);
    }
    if (s.motion && p.state && s.show !== "compare") {
      if (p.state === "solid") {
        // Vibration: two short arcs over three particles of the top row.
        for (const j of [8, 9, 11]) {
          const c = SOLID[j] as Pt;
          const px = bx + c[0] * side;
          const py = boxY + c[1] * side;
          const arc = (lo: number, hi: number) =>
            `M${n(px - 0.6 * r)},${n(py - lo * r)} Q${n(px)},${n(py - hi * r)} ${n(px + 0.6 * r)},${n(py - lo * r)}`;
          out.push(
            `<path d="${arc(1.3, 1.7)} ${arc(1.65, 2.05)}" fill="none" stroke="${x.c.ink}" stroke-width="1.5" stroke-linecap="round"/>`,
          );
        }
      } else {
        const pts = p.state === "liquid" ? LIQUID : GAS;
        const len = p.state === "gas" ? 2.6 : 1.7;
        for (const [j, dx, dy] of MOVES[p.state] ?? []) {
          const c = pts[j] as Pt;
          const m = Math.hypot(dx, dy);
          const sx = bx + c[0] * side + (dx / m) * r * 1.1;
          const sy = boxY + c[1] * side + (dy / m) * r * 1.1;
          const ex = Math.max(bx + 3, Math.min(bx + side - 3, sx + (dx / m) * r * len));
          const ey = Math.max(boxY + 3, Math.min(boxY + side - 3, sy + (dy / m) * r * len));
          out.push(arrow(sx, sy, ex, ey, x.c.ink, 1.75, Math.max(6, r * 0.7)));
        }
      }
    }
    const nt = note(i);
    if (nt) {
      const lines = fitLines(
        x,
        nt,
        colW,
        3,
        Math.max(TYPE_FLOOR, fs * 0.9),
        WEIGHT.label,
      ) as string[];
      const b = blockSize(x, lines, Math.max(TYPE_FLOOR, fs * 0.9), WEIGHT.label);
      const y0 = boxY + side + wordH + 0.35 * fs;
      out.push(
        drawBlock(
          x,
          { x0: cx0 + colW / 2 - b.bw / 2, x1: cx0 + colW / 2 + b.bw / 2, y0, y1: y0 + b.bh },
          lines,
          Math.max(TYPE_FLOOR, fs * 0.9),
          {
            fill: x.c.ink,
          },
        ),
      );
    }
    if (hasArrows && i < k - 1) {
      const ax0 = cx0 + colW - (colW - side) / 2 + 4;
      const ax1 = ax0 + gap + (colW - side) - 8;
      const ay = boxY + side * (under ? 0.82 : 0.62);
      out.push(arrow(ax0, ay, ax1, ay, x.c.ink, 2.5, Math.max(9, fs * 0.55)));
      x.strokes?.push([ax0, ay, ax1, ay]);
      const word = arrowWord(i);
      if (word) {
        const lines = fitLines(
          x,
          word,
          under ? colW + gap - fs * 0.6 : gap - 6,
          2,
          Math.max(TYPE_FLOOR, fs * 0.9),
          600,
        ) as string[];
        const b = blockSize(x, lines, Math.max(TYPE_FLOOR, fs * 0.9), 600);
        const mid = (ax0 + ax1) / 2;
        const y1 = under ? boxY + side + 0.4 * fs + b.bh : ay - 0.3 * fs;
        out.push(
          drawBlock(
            x,
            { x0: mid - b.bw / 2, x1: mid + b.bw / 2, y0: y1 - b.bh, y1 },
            lines,
            Math.max(TYPE_FLOOR, fs * 0.9),
            {
              weight: WEIGHT.label,
              fill: x.c.ink,
            },
          ),
        );
      }
    }
  });
  if (key) {
    const ky = top + capH + side + noteH + keyH * 0.55;
    const kfs = Math.max(TYPE_FLOOR, fs * 0.9);
    const wa = textWidth(key[0], x, kfs, WEIGHT.label);
    const wb = textWidth(key[1], x, kfs, WEIGHT.label);
    const total = r * 2 + 6 + wa + 24 + r * 2 + 6 + wb;
    const entry = (cx0: number, cy: number, label: string, fill: string) => {
      out.push(
        `<circle cx="${n(cx0 + r)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}" stroke="${x.c.ink}" stroke-width="${STROKE.hair}"/>`,
      );
      out.push(text(x, cx0 + 2 * r + 6, cy, [label], { fs: kfs, anchor: "start" }));
    };
    if (total <= w) {
      const kx = (w - total) / 2;
      entry(kx, ky, key[0], x.c.accent);
      entry(kx + 2 * r + 6 + wa + 24, ky, key[1], x.c.accent2);
    } else {
      // Two rows, each entry centred, the second under the first.
      const y0 = top + capH + side + noteH + fs * 0.75;
      const one = (wl: number) => (w - (2 * r + 6 + wl)) / 2;
      entry(one(wa), y0, key[0], x.c.accent);
      entry(one(wb), y0 + fs * 1.3, key[1], x.c.accent2);
      if (2 * r + 6 + Math.max(wa, wb) > w) bad(x, "the key is wider than the drawing");
    }
  }
  return out.join("");
}

// ─── storm hydrograph ───────────────────────────────────────────────────────────────────────

const SHAPES = {
  flashy: {
    bars: [0.3, 0.65, 1, 0.7, 0.35, 0.15],
    b0: 0.04,
    step: 0.04,
    rise: 0.2,
    peak: 0.4,
    fall: 0.86,
    top: 1,
    end: 0.06,
  },
  gentle: {
    bars: [0.3, 0.55, 0.8, 1, 0.75, 0.5, 0.3],
    b0: 0.04,
    step: 0.04,
    rise: 0.24,
    peak: 0.6,
    fall: 1.05,
    top: 0.68,
    end: 0.12,
  },
} as const;

const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

export function drawHydrograph(s: Hydrograph, x0: Ctx, w: number, h: number): string {
  // Graph labels a step below the slide's diagram size: six features share one plot.
  const x: Ctx = {
    ...x0,
    fs: Math.min(x0.fs, Math.max(TYPE_FLOOR, Math.round(Math.min(w, h * 1.4) / 22))),
  };
  const sh = SHAPES[s.shape];
  const v = s.values ?? {};
  const marks = new Set(
    s.marks ?? [
      "peak-rainfall",
      "peak-discharge",
      "lag-time",
      "rising-limb",
      "falling-limb",
      "base-flow",
    ],
  );
  const numbers =
    v.peakDischarge !== undefined || v.peakRainfall !== undefined || v.lagHours !== undefined;
  const fs = x.fs;
  // DIAGRAM-AUDIT look #8: axis titles at the label size, ticks a step down, never under the floor.
  const afs = fs;
  const tfs = sub(fs);
  const sc = scene();
  const out: string[] = [];
  const peakRainU = sh.b0 + sh.bars.indexOf(1) * sh.step;
  // Time: with a lag given, the axis is long enough that the peaks are the lag apart.
  // Rounded to 6 hours, with the peaks a little further apart than the preset so "Lag time" fits.
  const hours = v.lagHours ? Math.ceil(v.lagHours / (sh.peak - peakRainU + 0.06) / 2) * 2 : 48;
  const uOf = (hrs: number) => hrs / hours;
  const peakU = v.lagHours ? peakRainU + uOf(v.lagHours) : sh.peak;
  const riseU = peakU - (sh.peak - sh.rise);
  const fallU = peakU + (sh.fall - sh.peak);
  // Each axis fitted to its own data: the peak near 80 % of the discharge axis, the rain near 45 %
  // of its own (the bars sit under the hump, never a sliver).
  const qMax = v.peakDischarge ? niceTop(v.peakDischarge / 0.8) : 1;
  const top = v.peakDischarge ? v.peakDischarge / qMax : 0.8 * sh.top;
  const base =
    v.baseFlow !== undefined && v.peakDischarge ? Math.min(top * 0.5, v.baseFlow / qMax) : 0.16;
  const end = base + sh.end * (top - base) * 0.6;
  const q = (u: number) =>
    u <= riseU
      ? base
      : u <= peakU
        ? base + (top - base) * smooth((u - riseU) / (peakU - riseU))
        : end + (top - end) * (1 - smooth((u - peakU) / (fallU - peakU)));
  const rMax = v.peakRainfall ? niceTop(v.peakRainfall / 0.45) : 1;
  const rainTop = v.peakRainfall ? v.peakRainfall / rMax : 0.36;
  if (v.peakDischarge) x.axes?.push({ name: "discharge", max: qMax, data: v.peakDischarge });
  if (v.peakRainfall) x.axes?.push({ name: "rainfall", max: rMax, data: v.peakRainfall });

  // Margins: rotated axis titles, tick numbers when there are values, the lag band on top.
  const lt = (a: string, b: string, room: number) => (textWidth(a, x, afs, 600) <= room ? a : b);
  const qTicks = numbers && v.peakDischarge ? ticks(0, qMax, undefined, 5) : [];
  const rTicks = numbers && v.peakRainfall ? ticks(0, rMax, undefined, 5) : [];
  const tw = (vals: number[]) => Math.max(0, ...vals.map((t) => textWidth(num(t), x, tfs)));
  const L = 4 + afs * 1.25 + (qTicks.length ? tw(qTicks) + 8 : 4);
  const Rm = 4 + afs * 1.25 + (rTicks.length ? tw(rTicks) + 8 : 4);
  const lag = marks.has("lag-time");
  const rowH =
    lag && marks.has("peak-rainfall") && marks.has("peak-discharge") ? 2.3 * fs : 0.4 * fs;
  const band = lag ? rowH + 1.1 * fs : fs * 0.6;
  const bottom = afs * 1.5 + (numbers ? tfs * 1.4 : 4);
  const X0 = L;
  const X1 = w - Rm;
  const Y0 = band;
  const Y1 = h - bottom;
  const pw = X1 - X0;
  const ph = Y1 - Y0;
  if (pw < 160 || ph < 110) {
    bad(x, "the hydrograph's plot is squashed");
  }
  const X = (u: number) => X0 + u * pw;
  const Y = (t: number) => Y1 - t * ph;
  const ink = x.c.ink;

  // Rainfall bars (right axis).
  const bw = sh.step * pw * 0.86;
  sh.bars.forEach((f, i) => {
    const u = sh.b0 + i * sh.step;
    const bh = f * rainTop * ph;
    out.push(
      `<rect x="${n(X(u) - bw / 2)}" y="${n(Y1 - bh)}" width="${n(bw)}" height="${n(bh)}" fill="${mix(x.c.accent2, x.c.surface, 0.55)}" stroke="${x.c.accent2}" stroke-width="1.5"/>`,
    );
    sc.boxes.push({ x0: X(u) - bw / 2, x1: X(u) + bw / 2, y0: Y1 - bh, y1: Y1 });
  });
  // Modern looks: the rain bars sit behind the lines, which cut through them on a ground-coloured
  // underlay, so a bar taller than the base flow never reads as drawn over it.
  const under = look().preset !== "current";
  // Base flow, dashed.
  out.push(
    under
      ? `<line x1="${n(X0)}" y1="${n(Y(base))}" x2="${n(X1)}" y2="${n(Y(base))}" stroke="${x.c.bg}" stroke-width="6"/>`
      : "",
    `<line x1="${n(X0)}" y1="${n(Y(base))}" x2="${n(X1)}" y2="${n(Y(base))}" stroke="${x.c.muted}" stroke-width="1.5" stroke-dasharray="6 5"/>`,
  );
  addLine(x, sc, [
    [X0, Y(base)],
    [X1, Y(base)],
  ]);
  // Discharge curve.
  const pts: Pt[] = [];
  for (let i = 0; i <= 80; i++) pts.push([X(i / 80), Y(q(i / 80))]);
  out.push(
    under
      ? `<polyline points="${pts.map(([a, b]) => `${n(a)},${n(b)}`).join(" ")}" fill="none" stroke="${x.c.bg}" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>`
      : "",
    `<polyline points="${pts.map(([a, b]) => `${n(a)},${n(b)}`).join(" ")}" fill="none" stroke="${x.c.accent}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`,
  );
  addLine(x, sc, pts);
  // Axes.
  out.push(
    // Modern looks: the baseline only; light gridlines carry the scale.
    look().preset === "current"
      ? `<path d="M${n(X0)},${n(Y0 - 4)} L${n(X0)},${n(Y1)} L${n(X1)},${n(Y1)} L${n(X1)},${n(Y0 - 4)}" fill="none" stroke="${ink}" stroke-width="2"/>`
      : `<line x1="${n(X0)}" y1="${n(Y1)}" x2="${n(X1)}" y2="${n(Y1)}" stroke="${ink}" stroke-width="2"/>`,
  );
  addLine(x, sc, [
    [X0, Y0 - 4],
    [X0, Y1],
    [X1, Y1],
    [X1, Y0 - 4],
  ]);
  for (const t of qTicks) {
    out.push(
      look().preset === "current"
        ? `<line x1="${n(X0 - 5)}" y1="${n(Y(t / qMax))}" x2="${n(X0)}" y2="${n(Y(t / qMax))}" stroke="${ink}" stroke-width="1.5"/>`
        : t > 0
          ? `<line x1="${n(X0)}" y1="${n(Y(t / qMax))}" x2="${n(X1)}" y2="${n(Y(t / qMax))}" stroke="${x.c.line}" stroke-width="1.5"/>`
          : "",
    );
    out.push(text(x, X0 - 8, Y(t / qMax), [num(t)], { fs: tfs, anchor: "end" }));
    sc.labels.push({
      x0: X0 - 8 - tw([t]),
      x1: X0 - 8,
      y0: Y(t / qMax) - tfs * 0.6,
      y1: Y(t / qMax) + tfs * 0.6,
    });
  }
  for (const t of rTicks) {
    out.push(
      look().preset === "current"
        ? `<line x1="${n(X1)}" y1="${n(Y(t / rMax))}" x2="${n(X1 + 5)}" y2="${n(Y(t / rMax))}" stroke="${ink}" stroke-width="1.5"/>`
        : "",
    );
    out.push(text(x, X1 + 8, Y(t / rMax), [num(t)], { fs: tfs, anchor: "start" }));
    sc.labels.push({
      x0: X1 + 8,
      x1: X1 + 8 + tw([t]),
      y0: Y(t / rMax) - tfs * 0.6,
      y1: Y(t / rMax) + tfs * 0.6,
    });
  }
  if (numbers) {
    const hStep =
      [1, 2, 6, 12, 24, 48].find(
        (st) => hours / st <= 7 && (st / hours) * pw >= textWidth("000", x, tfs) * 1.8,
      ) ?? 48;
    for (let t = 0; t <= hours + 1e-9; t += hStep) {
      out.push(
        look().preset === "current"
          ? `<line x1="${n(X(uOf(t)))}" y1="${n(Y1)}" x2="${n(X(uOf(t)))}" y2="${n(Y1 + 5)}" stroke="${ink}" stroke-width="1.5"/>`
          : "",
      );
      out.push(text(x, X(uOf(t)), Y1 + 6, [num(t)], { fs: tfs, v: "top" }));
    }
  }
  const xTitle = numbers ? "Time (hours)" : "Time";
  out.push(text(x, (X0 + X1) / 2, h - 2, [xTitle], { fs: afs, weight: WEIGHT.label, v: "bottom" }));
  const rot = (label: string, cx: number, cy: number, deg: number) => {
    const len = textWidth(label, x, afs, 600);
    x.rec?.push({
      x0: cx - afs * 0.6,
      x1: cx + afs * 0.6,
      y0: cy - len / 2,
      y1: cy + len / 2,
      text: label,
      cut: len > ph + band,
    });
    return `<text transform="rotate(${deg} ${n(cx)} ${n(cy)})" x="${n(cx)}" y="${n(cy + afs * 0.35)}" font-family="${x.body}" font-size="${afs}" font-weight="600" fill="${ink}" text-anchor="middle">${label}</text>`;
  };
  out.push(rot(lt("Discharge (m³/s)", "Discharge", ph), afs * 0.7, (Y0 + Y1) / 2, -90));
  out.push(rot(lt("Rainfall (mm)", "Rainfall", ph), w - afs * 0.7, (Y0 + Y1) / 2, 90));

  // Lag time (the textbook layout): the two peaks named over the ends of a double arrow, guides
  // down to each peak, "Lag time" under the arrow between the guides.
  const rx = X(peakRainU);
  const px = X(peakU);
  const py = Y(top);
  const ry = Y(rainTop);
  let peaksInBand = false;
  if (lag) {
    const ay = rowH + 0.55 * fs;
    const both = [
      ["Peak rainfall", rx],
      ["Peak discharge", px],
    ] as const;
    const set = (ls: number) =>
      both.map(([word, cx]) => {
        const lines = fitLines(x, word, 999, ls, fs, 700) ?? [word];
        const l2 = ls === 2 ? word.split(" ") : lines;
        const { bw: bwid, bh } = blockSize(x, l2, fs, 700);
        const mid = Math.max(bwid / 2 + 2, Math.min(w - bwid / 2 - 2, cx));
        return {
          lines: l2,
          b: { x0: mid - bwid / 2, x1: mid + bwid / 2, y0: rowH - bh, y1: rowH } as Box,
        };
      });
    const fits = (p: ReturnType<typeof set>) => {
      const [a, b] = p as [(typeof p)[0], (typeof p)[0]];
      // A clear gap of a label's size between the two names, or they read as one phrase.
      return a.b.x1 + fs < b.b.x0;
    };
    const one = set(1);
    const two = set(2);
    const pick = fits(one) ? one : fits(two) ? two : undefined;
    if (pick && marks.has("peak-rainfall") && marks.has("peak-discharge")) {
      peaksInBand = true;
      for (const p of pick) {
        sc.labels.push(p.b);
        out.push(
          drawBlock(x, p.b, p.lines, fs, {
            weight: look().preset === "current" ? 700 : WEIGHT.name,
            halo: x.c.bg,
          }),
        );
      }
    }
    out.push(
      `<line x1="${n(rx)}" y1="${n(ay)}" x2="${n(rx)}" y2="${n(ry - 2)}" stroke="${x.c.muted}" stroke-width="1.5" stroke-dasharray="4 4"/>`,
    );
    out.push(
      `<line x1="${n(px)}" y1="${n(ay)}" x2="${n(px)}" y2="${n(py - 2)}" stroke="${x.c.muted}" stroke-width="1.5" stroke-dasharray="4 4"/>`,
    );
    // The dashed guides are not obstacles: a label may cross one on its halo.
    out.push(
      `<line x1="${n(rx + 8)}" y1="${n(ay)}" x2="${n(px - 8)}" y2="${n(ay)}" stroke="${ink}" stroke-width="2"/>`,
    );
    out.push(arrowHead(rx, ay, px, ay, 9, ink), arrowHead(px, ay, rx, ay, 9, ink));
    addLine(x, sc, [
      [rx, ay],
      [px, ay],
    ]);
    const word = v.lagHours ? `Lag time: ${num(v.lagHours)}\u00a0h` : "Lag time";
    out.push(
      placeFirst(x, sc, w, h, [
        {
          text: word,
          at: [(rx + px) / 2, ay],
          prefer: ["s"],
          maxW: Math.max(textWidth("Lag time:", x, x.fs, 600) + 2, px - rx - 12),
          bounds: { x0: rx + 4, x1: px - 4, y0: ay, y1: Y1 - 3 },
        },
        {
          text: word,
          at: [px + 2, ay],
          prefer: ["e"],
          maxW: w * 0.4,
          bounds: { x0: px + 4, x1: w - 2, y0: ay - 1.5 * fs, y1: Y1 - 3 },
        },
        { text: word, at: [(rx + px) / 2, ay], prefer: ["s", "se", "e"], maxW: w * 0.3 },
      ]),
    );
  }
  const labelAt = (
    on: boolean,
    word: string,
    at: Pt,
    prefer: ("n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw")[],
    side?: { x0?: number; x1?: number },
  ) => {
    if (on)
      out.push(
        placeLabel(x, sc, w, h, {
          text: word,
          at,
          prefer,
          maxW: Math.min(pw * 0.42, 150),
          bounds: { x0: side?.x0 ?? X0 + 3, x1: side?.x1 ?? X1 - 3, y0: Y0 - 2, y1: Y1 - 3 },
        }),
      );
  };
  labelAt(
    marks.has("peak-discharge") && !peaksInBand,
    "Peak discharge",
    [px, py],
    ["ne", "e", "nw"],
  );
  labelAt(
    marks.has("peak-rainfall") && !peaksInBand,
    "Peak rainfall",
    [rx + bw / 2, ry + 4],
    ["ne", "e", "n"],
  );
  const ru = riseU + (peakU - riseU) * 0.55;
  // A limb's name stays on its own side of the peak, so it never reads as the other limb's.
  if (marks.has("rising-limb")) {
    const r: LabelReq = {
      text: "Rising limb",
      at: [X(ru), Y(q(ru))],
      prefer: ["w", "nw", "sw", "e"],
      maxW: Math.min(pw * 0.42, 150),
    };
    const plot = { x0: X0 + 3, x1: X1 - 3, y0: Y0 - 2, y1: Y1 - 3 };
    out.push(
      placeFirst(x, sc, w, h, [
        { ...r, bounds: { ...plot, x1: px - 4 } },
        { ...r, bounds: plot },
      ]),
    );
  }
  const fu = peakU + (fallU - peakU) * 0.32;
  if (marks.has("falling-limb")) {
    const req = (u: number, soft: boolean) =>
      placeLabel(x, sc, w, h, {
        text: "Falling limb",
        at: [X(u), Y(q(u))],
        prefer: ["ne", "e", "se"],
        maxW: Math.min(pw * 0.42, 150),
        bounds: { x0: px + 4, x1: X1 - 3, y0: Y0 - 2, y1: Y1 - 3 },
        soft,
      });
    out.push(
      req(fu, true) ||
        req(peakU + (fallU - peakU) * 0.5, true) ||
        req(peakU + (fallU - peakU) * 0.18, true) ||
        placeLabel(x, sc, w, h, {
          text: "Falling limb",
          at: [X(fu), Y(q(fu))],
          prefer: ["ne", "e", "se", "n"],
          maxW: Math.min(pw * 0.42, 150),
          bounds: { x0: X0 + 3, x1: X1 - 3, y0: Y0 - 2, y1: Y1 - 3 },
        }),
    );
  }
  if (marks.has("base-flow")) {
    const req = (u: number, soft: boolean) =>
      placeLabel(x, sc, w, h, {
        text: "Base flow",
        at: [X(u), Y(base)],
        prefer: ["n", "nw", "s"],
        maxW: Math.min(pw * 0.42, 150),
        bounds: { x0: X0 + 3, x1: X1 - 3, y0: Y0 - 2, y1: Y1 - 3 },
        soft,
      });
    out.push(req(0.94, true) || req(0.8, true) || req(0.66, false));
  }
  out.push(drawKey(x, sc, w, h));
  return out.join("");
}

// ─── timeline ───────────────────────────────────────────────────────────────────────────────

/** A date's year (BC negative), or undefined when it names none ("Later that year"). */
export function yearOf(date: string): number | undefined {
  const m = /\b(\d{1,4})\s*(BCE|BC)?\b/i.exec(date);
  if (!m?.[1]) return undefined;
  const y = Number(m[1]);
  if (m[2] || /\bBC/i.test(date)) return -y;
  return y;
}

/**
 * DIAGRAM-AUDIT guard: the gaps (index i: between events i and i+1) far longer than the shortest
 * one, when every date names a year in order. Events are spaced evenly, so a long gap gets a break
 * mark on the line: 55 BC, 54 BC and AD 43 no longer read as equal steps.
 */
export function longGaps(s: Timeline): Set<number> {
  const ys = s.events.map((e) => yearOf(e.date));
  if (ys.some((y) => y === undefined)) return new Set();
  const gaps = (ys as number[]).slice(1).map((y, i) => y - (ys[i] as number));
  if (gaps.some((g) => g < 0)) return new Set();
  const pos = gaps.filter((g) => g > 0);
  const least = pos.length ? Math.min(...pos) : 0;
  if (!least) return new Set();
  return new Set(gaps.flatMap((g, i) => (g >= 8 * least ? [i] : [])));
}

/** A break mark (two slashes on a ground-coloured gap) across a line at (cx, cy). */
function breakMark(x: Ctx, cx: number, cy: number, vertical: boolean): string {
  const d = 0.45 * x.fs;
  const g = 0.22 * x.fs;
  const sl = (o: number) =>
    vertical
      ? `<line x1="${n(cx - d)}" y1="${n(cy + o - g)}" x2="${n(cx + d)}" y2="${n(cy + o + g)}" stroke="${x.c.ink}" stroke-width="2.5" stroke-linecap="round"/>`
      : `<line x1="${n(cx + o - g)}" y1="${n(cy + d)}" x2="${n(cx + o + g)}" y2="${n(cy - d)}" stroke="${x.c.ink}" stroke-width="2.5" stroke-linecap="round"/>`;
  const gap = vertical
    ? `<rect x="${n(cx - d)}" y="${n(cy - g)}" width="${n(2 * d)}" height="${n(2 * g)}" fill="${x.c.bg}"/>`
    : `<rect x="${n(cx - g)}" y="${n(cy - d)}" width="${n(2 * g)}" height="${n(2 * d)}" fill="${x.c.bg}"/>`;
  return gap + sl(-g) + sl(g);
}

/** The year gaps between events, or undefined when a date names no year or runs backwards. */
function yearGaps(s: Timeline): number[] | undefined {
  // Round 8: months and days count (two events in "January 1923" and "November 1923" are not one point).
  const ys = s.events.map((e) => timeOf(e.date));
  if (ys.length < 2 || ys.some((y) => y === undefined)) return undefined;
  const g = (ys as number[]).slice(1).map((y, i) => y - (ys[i] as number));
  return g.some((v) => v < 0) ? undefined : g;
}

/**
 * Event x positions from `a` to `b` spaced by date, and the gaps drawn broken, or undefined.
 * BAKEOFF round 8 (55 BC, 54 BC, AD 43 drew one year as wide as twenty): every unbroken gap is to
 * one scale. When that scale would set two events closer than `minPx`, the longest gaps are broken
 * (a break mark, the gap drawn short) one at a time, and the rest are drawn at the smallest scale
 * that keeps the closest pair `minPx` apart, so a cluster stays a cluster. Never evenly.
 */
function datedXs(
  s: Timeline,
  a: number,
  b: number,
  minPx: number,
): { xs: number[]; breaks: Set<number> } | undefined {
  const g = yearGaps(s);
  if (!g || g.every((v) => v === 0)) return undefined;
  const L = b - a;
  const at = (scale: (v: number, i: number) => number) => {
    const out = [a];
    g.forEach((v, i) => {
      out.push((out[out.length - 1] as number) + scale(v, i));
    });
    return out;
  };
  const total = g.reduce((p, q) => p + q, 0);
  const least = (vs: number[]) => Math.min(...vs.filter((v) => v > 0));
  if (least(g) * (L / total) >= minPx) return { xs: at((v) => (L * v) / total), breaks: new Set() };
  const order = g.map((v, i) => [v, i] as const).sort((p, q) => q[0] - p[0]);
  const breaks = new Set<number>();
  for (const [v, i] of order) {
    const rest = g.filter((_, j) => j !== i && !breaks.has(j));
    if (!rest.some((r) => r > 0)) break;
    // Only a gap far longer than every gap left unbroken is worth a break.
    if (v < 4 * Math.max(...rest)) break;
    breaks.add(i);
    const U = rest.reduce((p, q) => p + q, 0);
    const scale = minPx / least(rest);
    const bw = (L - scale * U) / breaks.size;
    if (bw >= Math.max(3 * minPx, scale * Math.max(...rest)))
      return { xs: at((u, j) => (breaks.has(j) ? bw : u * scale)), breaks };
  }
  // No break helps: one scale throughout, the labels spread on leaders.
  return { xs: at((v) => (L * v) / total), breaks: new Set() };
}

/**
 * Label centres for events at `xs` on one side of the line, widths `bw`, kept `gap` apart and
 * inside [lo, hi]: each as near its event as it can stand (a leader joins them), or undefined.
 */
function spread(xs: number[], bw: number[], gap: number, lo: number, hi: number) {
  const c = xs.map((v, i) =>
    Math.max(lo + (bw[i] as number) / 2, Math.min(hi - (bw[i] as number) / 2, v)),
  );
  for (let i = 1; i < c.length; i++)
    c[i] = Math.max(
      c[i] as number,
      (c[i - 1] as number) + ((bw[i - 1] as number) + (bw[i] as number)) / 2 + gap,
    );
  for (let i = c.length - 1; i >= 0; i--) {
    const cap =
      i === c.length - 1
        ? hi - (bw[i] as number) / 2
        : (c[i + 1] as number) - ((bw[i + 1] as number) + (bw[i] as number)) / 2 - gap;
    c[i] = Math.min(c[i] as number, cap);
  }
  return c.every((v, i) => v - (bw[i] as number) / 2 >= lo - 0.5) ? c : undefined;
}

export function drawTimeline(s: Timeline, x: Ctx, w: number, h: number): string {
  const k = s.events.length;
  const pad = 6;
  const slot = (w - 2 * pad) / k;
  const even = s.events.map((_, i) => pad + slot * (i + 0.5));
  const modern = look().preset !== "current";
  // Modern looks: events stand by date (a long gap capped at three times the median and marked
  // with a break, a short one held to three quarters of the mean gap), evenly only when that will not fit.
  const span = modern ? datedXs(s, pad + x.fs * 1.2, w - pad - x.fs * 1.6, x.fs * 1.5) : undefined;
  const dated = span?.xs;
  let xs = even;
  let mids: number[] = [];
  const colW = Math.min(slot * 2 - 10, w * 0.42);
  const stem = 0.9 * x.fs;
  type Fit = {
    fs: number;
    blocks: { date: string[]; body: string[]; bw: number; bh: number }[];
    up: number;
    down: number;
    per: number;
  };
  let fit: Fit | undefined;
  // Modern looks: labels keep an inset from the drawing's edges.
  const edge = modern ? Math.max(8, x.fs * 0.5) : 2;
  const midOf = (cx: number, bw: number) =>
    Math.max(bw / 2 + edge, Math.min(w - bw / 2 - edge, cx));
  // DIAGRAM-AUDIT look #7: many events go down the slot at a readable size before crowding across it.
  const floor = k > 5 ? Math.max(TYPE_FLOOR, x.fs - 4) : TYPE_FLOOR;
  // Dated events are never spaced evenly: a dated line that will not fit reads downwards instead.
  for (const cand of dated ? [dated] : [even])
    for (let fs = x.fs; fs >= floor && !fit; fs -= 1) {
      for (const share of modern ? [1, 0.82, 0.66, 0.54] : [1, 0.82, 0.66]) {
        if (fit) break;
        xs = cand;
        const cw = colW * share;
        const blocks = s.events.map((e) => {
          const date = fitLines(x, e.date, cw, 1, fs, 700);
          const body = fitLines(x, e.text, cw, modern ? 4 : 3, sub(fs, 0.92), WEIGHT.label);
          if (!date || !body) return undefined;
          const bw = Math.max(
            blockSize(x, date, fs, 700).bw,
            blockSize(x, body, sub(fs, 0.92), WEIGHT.label).bw,
          );
          const bh = 1.05 * fs + 0.15 * fs + blockSize(x, body, sub(fs, 0.92), WEIGHT.label).bh;
          return { date, body, bw, bh };
        });
        if (blocks.some((b) => !b)) continue;
        const bs = blocks as Fit["blocks"];
        const up = Math.max(...bs.filter((_, i) => i % 2 === 0).map((b) => b.bh));
        const down = Math.max(0, ...bs.filter((_, i) => i % 2 === 1).map((b) => b.bh));
        const per = s.period ? 1.1 * fs + 0.9 * fs : 0;
        if (up + down + 2 * stem + per + 12 > h) continue;
        // Dated: each side's labels spread apart on leaders, as near their events as they can.
        if (cand === dated) {
          const m: number[] = [];
          let ok = true;
          for (const side of [0, 1]) {
            const ids = bs.map((_, i) => i).filter((i) => i % 2 === side);
            const c = spread(
              ids.map((i) => cand[i] as number),
              ids.map((i) => (bs[i] as Fit["blocks"][number]).bw),
              0.8 * fs,
              edge,
              w - edge,
            );
            if (!c) ok = false;
            else
              ids.forEach((i, j) => {
                m[i] = c[j] as number;
              });
          }
          if (!ok) continue;
          mids = m;
          fit = { fs, blocks: bs, up, down, per };
          continue;
        }
        // Neighbours on the same side, where they are drawn (edge labels move in), keep a clear gap.
        const clash = bs.some((b, i) => {
          const o = bs[i + 2];
          if (!o) return false;
          const a = midOf(xs[i] as number, b.bw) + b.bw / 2;
          const c = midOf(xs[i + 2] as number, o.bw) - o.bw / 2;
          return a + 0.8 * fs > c;
        });
        if (clash) continue;
        fit = { fs, blocks: bs, up, down, per };
      }
    }

  if (!fit) return drawTimelineDown(s, x, w, h);
  const { fs, blocks, up, down, per } = fit;
  const total = up + down + 2 * stem + per;
  const lineY = (h - total) / 2 + up + stem;
  const out: string[] = [];
  out.push(arrow(pad, lineY, w - pad, lineY, x.c.ink, 3, 12));
  x.strokes?.push([pad, lineY, w - pad, lineY]);
  if (s.period) {
    const a = xs[s.period.from - 1] as number;
    const b = xs[s.period.to - 1] as number;
    out.push(
      `<line x1="${n(a)}" y1="${n(lineY)}" x2="${n(b)}" y2="${n(lineY)}" stroke="${x.c.accent2}" stroke-width="9" stroke-linecap="round"/>`,
    );
    const by = lineY + stem + down + 0.35 * fs;
    out.push(hBrace(a, b, by, -0.55 * fs, x.c.accent2, 2.5));
    const lines = fitLines(x, s.period.label, Math.max(b - a, colW), 1, sub(fs, 0.92), 700) ?? [
      s.period.label,
    ];
    const lw = blockSize(x, lines, sub(fs, 0.92), 700).bw;
    const mid = Math.max(lw / 2 + 2, Math.min(w - lw / 2 - 2, (a + b) / 2));
    out.push(
      text(x, mid, by + 0.6 * fs, lines, {
        fs: sub(fs, 0.92),
        weight: 700,
        v: "top",
        fill: x.c.ink,
      }),
    );
  }
  for (const i of dated && xs === dated ? (span?.breaks ?? []) : longGaps(s))
    out.push(breakMark(x, ((xs[i] as number) + (xs[i + 1] as number)) / 2, lineY, false));
  blocks.forEach((b, i) => {
    const cx = xs[i] as number;
    const above = i % 2 === 0;
    const mid = xs === dated ? (mids[i] ?? cx) : midOf(cx, b.bw);
    const y0 = above ? lineY - stem - b.bh : lineY + stem;
    // The stem is a leader: it runs from the event to its words where they stand.
    const lx = Math.max(mid - b.bw / 2 + 4, Math.min(mid + b.bw / 2 - 4, cx));
    out.push(
      `<line x1="${n(cx)}" y1="${n(lineY)}" x2="${n(lx)}" y2="${n(above ? lineY - stem + 3 : lineY + stem - 3)}" stroke="${x.c.muted}" stroke-width="2"/>`,
    );
    out.push(
      `<circle cx="${n(cx)}" cy="${n(lineY)}" r="${n(Math.max(6, fs * 0.32))}" fill="${x.c.accent}" stroke="${x.c.bg}" stroke-width="2"/>`,
    );
    out.push(text(x, mid, y0, b.date, { fs, weight: WEIGHT.value, v: "top", fill: x.c.ink }));
    out.push(text(x, mid, y0 + 1.2 * fs, b.body, { fs: sub(fs, 0.92), v: "top", fill: x.c.ink }));
  });
  return out.join("");
}

/** The timeline read downwards (many events in a narrow slot): dates left of the line, words right. */
function drawTimelineDown(s: Timeline, x: Ctx, w: number, h: number): string {
  const k = s.events.length;
  for (let fs = x.fs; fs >= TYPE_FLOOR; fs -= 1) {
    const dateW = Math.max(...s.events.map((e) => textWidth(e.date, x, fs, 700)));
    const lineX = dateW + 14;
    const bandW = s.period ? fs * 1.6 : 0;
    const textW = w - lineX - 16 - bandW - 4;
    const bodies = s.events.map((e) => fitLines(x, e.text, textW, 3, sub(fs, 0.92), WEIGHT.label));
    if (bodies.some((b) => !b)) continue;
    const hs = (bodies as string[][]).map((b) => blockSize(x, b, sub(fs, 0.92), WEIGHT.label).bh);
    const row = Math.min((h - 4) / k, Math.max(...hs) + 1.3 * fs);
    if (Math.max(...hs) + 0.4 * fs > row) continue;
    const top = (h - row * k) / 2;
    const yc = (i: number) => top + row * (i + 0.5);
    const out: string[] = [];
    // Modern looks: the timeline stands in the middle of its zone, not against its left edge.
    const bodyW = Math.max(
      ...(bodies as string[][]).map((b) => blockSize(x, b, sub(fs, 0.92), WEIGHT.label).bw),
    );
    const shift =
      look().preset === "current" ? 0 : Math.max(0, (w - (lineX + 16 + bodyW + bandW)) / 2);
    out.push(arrow(lineX, 2, lineX, h - 2, x.c.ink, 3, 12));
    x.strokes?.push([lineX, 2, lineX, h - 2]);
    if (s.period) {
      const a = yc(s.period.from - 1);
      const b = yc(s.period.to - 1);
      out.push(
        `<line x1="${n(lineX)}" y1="${n(a)}" x2="${n(lineX)}" y2="${n(b)}" stroke="${x.c.accent2}" stroke-width="9" stroke-linecap="round"/>`,
      );
      const bx = w - bandW / 2 - 2;
      out.push(
        `<line x1="${n(w - bandW - 2)}" y1="${n(a)}" x2="${n(w - bandW - 2)}" y2="${n(b)}" stroke="${x.c.accent2}" stroke-width="2.5"/>`,
      );
      const len = textWidth(s.period.label, x, sub(fs, 0.85), 700);
      if (len > b - a + row) bad(x, "the period's name is longer than its span");
      out.push(
        `<text transform="rotate(90 ${n(bx)} ${n((a + b) / 2)})" x="${n(bx)}" y="${n((a + b) / 2 + fs * 0.3)}" font-family="${x.body}" font-size="${n(sub(fs, 0.85))}" font-weight="700" fill="${x.c.ink}" text-anchor="middle">${s.period.label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`,
      );
    }
    for (const i of longGaps(s)) out.push(breakMark(x, lineX, (yc(i) + yc(i + 1)) / 2, true));
    s.events.forEach((e, i) => {
      const y = yc(i);
      out.push(
        `<circle cx="${n(lineX)}" cy="${n(y)}" r="${n(Math.max(6, fs * 0.32))}" fill="${x.c.accent}" stroke="${x.c.bg}" stroke-width="2"/>`,
      );
      out.push(text(x, lineX - 12, y, [e.date], { fs, weight: 700, anchor: "end" }));
      out.push(
        text(x, lineX + 16, y, bodies[i] as string[], { fs: sub(fs, 0.92), anchor: "start" }),
      );
    });
    if (shift > 0) {
      for (const r of x.rec?.slice(-2 * k) ?? []) {
        r.x0 += shift;
        r.x1 += shift;
      }
      const st = x.strokes?.[x.strokes.length - 1];
      if (st) {
        st[0] += shift;
        st[2] += shift;
      }
      return `<g transform="translate(${n(shift)},0)">${out.join("")}</g>`;
    }
    return out.join("");
  }
  bad(x, "the timeline's events do not fit the space");
  return "";
}

// ─── layers ─────────────────────────────────────────────────────────────────────────────────

export function drawLayers(s: Layers, x: Ctx, w: number, h: number): string {
  const blockW = w * 0.5;
  const labW = w - blockW - 0.18 * w;
  const total = s.layers.reduce((a, l) => a + l.thickness, 0);
  const top = 6;
  const H = h - 12;
  const fs = sizeFor(x, (f) => s.layers.every((l) => fitLines(x, l.label, labW, 2, f, 600)));
  const out: string[] = [];
  let y = top;
  const mids: number[] = [];
  s.layers.forEach((l, i) => {
    const lh = (l.thickness / total) * H;
    // DIAGRAM-AUDIT look #11: one hue, deepening downwards (from ink on dark themes, never mud).
    const share = 0.1 + (0.35 * i) / Math.max(1, s.layers.length - 1);
    const fill = mix(x.dark ? x.c.ink : x.c.accent, x.c.surface, x.dark ? share * 0.6 : share);
    out.push(
      `<rect x="2" y="${n(y)}" width="${n(blockW)}" height="${n(lh)}" fill="${fill}" stroke="${x.c.ink}" stroke-width="1.5"/>`,
    );
    x.strokes?.push([2, y, 2 + blockW, y]);
    mids.push(y + lh / 2);
    y += lh;
  });
  x.strokes?.push([2, y, 2 + blockW, y]);
  // Labels on the right, in layer order, spread so none meet, each on a leader to its layer.
  const blocks = s.layers.map((l) => {
    const lines = fitLines(x, l.label, labW, 2, fs, 600) ?? [l.label];
    return { lines, ...blockSize(x, lines, fs, 600) };
  });
  const ys = mids.map((m, i) => m - (blocks[i]?.bh ?? 0) / 2);
  for (let i = 1; i < ys.length; i++) {
    const prev = (ys[i - 1] as number) + (blocks[i - 1]?.bh ?? 0) + 6;
    if ((ys[i] as number) < prev) ys[i] = prev;
  }
  const overflow = (ys[ys.length - 1] as number) + (blocks[blocks.length - 1]?.bh ?? 0) - (h - 2);
  if (overflow > 0) {
    for (let i = ys.length - 1; i >= 0; i--) {
      const cap =
        i === ys.length - 1
          ? h - 2 - (blocks[i]?.bh ?? 0)
          : (ys[i + 1] as number) - (blocks[i]?.bh ?? 0) - 6;
      if ((ys[i] as number) > cap) ys[i] = cap;
    }
  }
  const lx = 2 + blockW + 0.14 * w;
  blocks.forEach((b, i) => {
    const y0 = ys[i] as number;
    const ty = y0 + b.bh / 2;
    const sx = 2 + blockW * 0.82;
    const sy = mids[i] as number;
    out.push(
      `<line x1="${n(sx)}" y1="${n(sy)}" x2="${n(lx - 6)}" y2="${n(ty)}" stroke="${x.c.ink}" stroke-width="1.75"/>`,
    );
    out.push(
      `<circle cx="${n(sx)}" cy="${n(sy)}" r="4" fill="${x.c.ink}" stroke="${x.c.bg}" stroke-width="1.5"/>`,
    );
    out.push(
      drawBlock(x, { x0: lx, x1: lx + b.bw, y0, y1: y0 + b.bh }, b.lines, fs, {
        weight: WEIGHT.label,
        anchor: "start",
      }),
    );
  });
  if (ys.some((v, i) => v < 2 || (i > 0 && v < (ys[i - 1] as number) + (blocks[i - 1]?.bh ?? 0))))
    bad(x, "the layer labels do not fit");
  return out.join("");
}

// ─── cycle ──────────────────────────────────────────────────────────────────────────────────

export function drawCycle(s: Cycle, x: Ctx, w: number, h: number): string {
  const k = s.steps.length;
  const cx = w / 2;
  const cy = h / 2;
  type Fit = { fs: number; bw: number; lines: string[][]; bh: number; boxes: Box[]; ang: number[] };
  let fit: Fit | undefined;
  for (let fs = x.fs; fs >= TYPE_FLOOR && !fit; fs -= 1) {
    for (let share = 0.42; share >= 0.24 && !fit; share -= 0.03) {
      const bw = w * share;
      const lines = s.steps.map((st) => fitLines(x, st, bw - 16, 3, fs, 600));
      if (lines.some((l) => !l)) continue;
      const ls = lines as string[][];
      const bh = Math.max(...ls.map((l) => blockSize(x, l, fs, 600).bh)) + 14;
      const rx = (w - bw) / 2 - 2;
      const ry = (h - bh) / 2 - 2;
      if (rx < 20 || ry < 20) continue;
      const ang = s.steps.map((_, i) => -Math.PI / 2 + (2 * Math.PI * i) / k);
      const boxes = ang.map((a) => {
        const bx = cx + rx * Math.cos(a);
        const by = cy + ry * Math.sin(a);
        return { x0: bx - bw / 2, x1: bx + bw / 2, y0: by - bh / 2, y1: by + bh / 2 };
      });
      if (boxes.some((b, i) => boxes.some((o, j) => j > i && overlaps(b, o, 22)))) continue;
      fit = { fs, bw, lines: ls, bh, boxes, ang };
    }
  }
  if (!fit) {
    bad(x, "the cycle's steps do not fit the space");
    return "";
  }
  const { fs, lines, ang, bw, bh } = fit;
  // BAKEOFF polish arm (uk-seasons fault 2): each box as wide as its words, not the ring's slab.
  const boxes = polishNodes()
    ? fit.boxes.map((b, i) => {
        const lw = Math.max(...(lines[i] as string[]).map((l) => textWidth(l, x, fs, 600)));
        const half = snug({ w: b.x1 - b.x0 }, lw, fs).w / 2;
        const mid = (b.x0 + b.x1) / 2;
        return { ...b, x0: mid - half, x1: mid + half };
      })
    : fit.boxes;
  const rx = (w - bw) / 2 - 2;
  const ry = (h - bh) / 2 - 2;
  const inside = (b: Box, [px, py]: Pt) =>
    px > b.x0 - 4 && px < b.x1 + 4 && py > b.y0 - 4 && py < b.y1 + 4;
  const out: string[] = [];
  // Arrows along the ellipse from each box to the next, clockwise.
  for (let i = 0; i < k; i++) {
    const a0 = ang[i] as number;
    const a1 = a0 + (2 * Math.PI) / k;
    const from = boxes[i] as Box;
    const to = boxes[(i + 1) % k] as Box;
    const pts: Pt[] = [];
    // Sampled finely, so each arrow starts and ends a fixed small gap (4) from the box edges.
    for (let t = 0; t <= 360; t++) {
      const a = a0 + ((a1 - a0) * t) / 360;
      const p: Pt = [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
      if (!inside(from, p) && !inside(to, p)) pts.push(p);
    }
    if (pts.length < 3) {
      bad(x, "the cycle's arrows have no room");
      continue;
    }
    const tip = pts[pts.length - 1] as Pt;
    const away = (p: Pt) => Math.hypot(p[0] - tip[0], p[1] - tip[1]) > 8;
    const prev = [...pts].reverse().find(away) ?? (pts[pts.length - 3] as Pt);
    out.push(
      `<polyline points="${pts
        .filter(away)
        .map(([a, b]) => `${n(a)},${n(b)}`)
        .join(" ")}" fill="none" stroke="${x.c.ink}" stroke-width="2.5" stroke-linecap="round"/>`,
    );
    out.push(arrowHead(tip[0], tip[1], prev[0], prev[1], 0, x.c.ink));
    x.arrows?.push({ tip, target: to });
    for (let j = 1; j < pts.length; j++) {
      const p = pts[j - 1] as Pt;
      const q = pts[j] as Pt;
      x.strokes?.push([p[0], p[1], q[0], q[1]]);
    }
  }
  boxes.forEach((b, i) => {
    out.push(
      polishNodes()
        ? `<rect x="${n(b.x0)}" y="${n(b.y0)}" width="${n(b.x1 - b.x0)}" height="${n(b.y1 - b.y0)}" rx="${n((b.y1 - b.y0) / 2)}" fill="${nodeFill(x.c, !!x.dark)}"/>`
        : `<rect x="${n(b.x0)}" y="${n(b.y0)}" width="${n(b.x1 - b.x0)}" height="${n(b.y1 - b.y0)}" rx="10" fill="${x.c.tint}" stroke="${x.c.accent}" stroke-width="2"/>`,
    );
    const l = lines[i] as string[];
    const bb = blockSize(x, l, fs, 600);
    const y0 = (b.y0 + b.y1) / 2 - bb.bh / 2;
    out.push(
      drawBlock(x, { x0: b.x0, x1: b.x1, y0, y1: y0 + bb.bh }, l, fs, { weight: WEIGHT.label }),
    );
  });
  return out.join("");
}

// ─── river ──────────────────────────────────────────────────────────────────────────────────

type RiverGeo = {
  ground: Pt[];
  water?: Pt[];
  marks: (t: (p: Pt) => Pt, x: Ctx, sc: Scene, has: Set<string>) => string;
  anchors: Record<
    string,
    { at: Pt; prefer: ("n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw")[] }
  >;
};

const RIVERS: Record<River["view"], RiverGeo> = {
  "v-valley": {
    ground: [
      [0, 22],
      [24, 22],
      [68, 78],
      [72, 90],
      [88, 90],
      [92, 78],
      [136, 22],
      [160, 22],
      [160, 100],
      [0, 100],
    ],
    water: [
      [70, 84],
      [90, 84],
      [88, 90],
      [72, 90],
    ],
    marks: (t, x, sc, has) => {
      if (!has.has("vertical-erosion")) return "";
      const [ax, ay] = t([80, 91]);
      const [bx, by] = t([80, 98]);
      addLine(x, sc, [
        [ax, ay],
        [bx, by],
      ]);
      return arrow(ax, ay, bx, by, x.c.accent2, 3, 10);
    },
    anchors: {
      "valley-side": { at: [44, 44], prefer: ["nw", "w", "n"] },
      channel: { at: [80, 86], prefer: ["ne", "e", "n"] },
      "river-bed": { at: [84, 90], prefer: ["se", "e", "s"] },
      "vertical-erosion": { at: [80, 98], prefer: ["e", "se", "w"] },
    },
  },
  "meander-section": {
    ground: [
      [0, 30],
      [30, 30],
      [33, 36],
      [38, 84],
      [50, 90],
      [72, 78],
      [150, 40],
      [160, 40],
      [160, 100],
      [0, 100],
    ],
    water: [
      [33.8, 44],
      [141.8, 44],
      [72, 78],
      [50, 90],
      [38, 84],
    ],
    marks: (t, x, _sc, has) => {
      const out: string[] = [];
      if (has.has("deposition")) {
        const poly = [
          [78, 75],
          [126, 52],
          [128, 56],
          [86, 76],
        ].map((p) => t(p as Pt));
        out.push(
          `<polygon points="${poly.map(([a, b]) => `${n(a)},${n(b)}`).join(" ")}" fill="${mix("#c9a227", x.c.surface, 0.55)}" stroke="none"/>`,
        );
      }
      if (has.has("erosion")) {
        const [ax, ay] = t([58, 62]);
        const [bx, by] = t([40, 62]);
        out.push(arrow(ax, ay, bx, by, x.c.accent2, 3, 10));
      }
      if (has.has("fastest-flow")) {
        const [ax, ay] = t([46, 72]);
        out.push(
          `<circle cx="${n(ax)}" cy="${n(ay)}" r="9" fill="${x.c.surface}" stroke="${x.c.accent2}" stroke-width="2.5"/><circle cx="${n(ax)}" cy="${n(ay)}" r="3" fill="${x.c.accent2}"/>`,
        );
      }
      return out.join("");
    },
    anchors: {
      "river-cliff": { at: [35, 50], prefer: ["w", "nw", "sw"] },
      "slip-off-slope": { at: [110, 59.5], prefer: ["ne", "e", "n"] },
      "fastest-flow": { at: [46, 72], prefer: ["sw", "w", "s"] },
      erosion: { at: [58, 62], prefer: ["e", "ne", "se"] },
      deposition: { at: [100, 64], prefer: ["se", "e", "s"] },
      "outer-bank": { at: [31, 31], prefer: ["n", "nw", "ne"] },
      "inner-bank": { at: [148, 41], prefer: ["n", "ne", "nw"] },
    },
  },
  "meander-plan": {
    ground: [],
    marks: () => "",
    anchors: {
      "outer-bank": { at: [80, 21.5], prefer: ["n", "ne", "nw"] },
      "inner-bank": { at: [80, 38.5], prefer: ["s", "se", "sw"] },
      "river-cliff": { at: [109, 29], prefer: ["ne", "e", "n"] },
      "slip-off-slope": { at: [80, 50], prefer: ["s", "sw", "se"] },
      "fastest-flow": { at: [53, 32], prefer: ["nw", "w", "n"] },
      "flow-direction": { at: [30, 86], prefer: ["e", "w", "ne"] },
    },
  },
};

/** The meander's centreline (plan view), a bend opening downward. */
const BEND = (u: number): Pt => {
  const a = Math.PI * (1 - u);
  return [80 + 50 * Math.cos(a), 78 - 48 * Math.sin(a)];
};

/**
 * Where a meander section's names stand, in the section's own units: each beside the feature it
 * names, with room measured from the drawing (water, land under the slope, land left of the
 * cliff). `room` is the width in units a name may take; a leader only where the name stands off
 * its point. Undefined when a name does not fit its room at the floor (the section then falls
 * back to placed labels, and steps up when those crowd).
 */
const MEANDER_SPOTS: Record<
  string,
  { at: Pt; anchor: "start" | "middle" | "end"; room: number; leader?: Pt }
> = {
  "river-cliff": { at: [30.5, 50], anchor: "end", room: 29, leader: [35, 50] },
  "fastest-flow": { at: [49.5, 72], anchor: "start", room: 32 },
  erosion: { at: [60.5, 62], anchor: "start", room: 20 },
  deposition: { at: [97, 56.5], anchor: "middle", room: 26 },
  "slip-off-slope": { at: [128, 68.5], anchor: "middle", room: 34, leader: [112, 58.5] },
  "outer-bank": { at: [16, 25], anchor: "middle", room: 30 },
  "inner-bank": { at: [146, 35], anchor: "middle", room: 26 },
};

function meanderSpots(s: River, x: Ctx, k: number) {
  if (!s.labels.every((l) => MEANDER_SPOTS[l.part])) return undefined;
  for (let fs = x.fs; fs >= TYPE_FLOOR; fs -= 1) {
    const items = s.labels.map((l) => {
      const sp = MEANDER_SPOTS[l.part] as (typeof MEANDER_SPOTS)[string];
      return { ...sp, text: l.text, bw: textWidth(l.text, x, fs, WEIGHT.name) };
    });
    if (items.every((it) => it.bw <= it.room * k)) return { fs, items };
  }
  return undefined;
}

/**
 * A section's names in one row, ordered as their anchors run left to right and spread so none
 * touch, at the largest size from the label size down to the floor; undefined when they do not fit.
 */
function sectionRow(s: River, x: Ctx, w: number, ox: number, k: number) {
  const geo = RIVERS[s.view];
  const named = s.labels
    .filter((l) => geo.anchors[l.part])
    .map((l) => ({ ...l, ax: ox + (geo.anchors[l.part]?.at[0] ?? 0) * k }))
    .sort((a, b) => a.ax - b.ax);
  for (let fs = x.fs; fs >= TYPE_FLOOR; fs -= 1) {
    const gap = fs;
    const items = named.map((l) => ({
      text: l.text,
      part: l.part,
      ax: l.ax,
      bw: textWidth(l.text, x, fs, WEIGHT.name),
      cx: l.ax,
    }));
    const total = items.reduce((a, it) => a + it.bw, 0) + gap * (items.length - 1);
    if (total > w - 8) continue;
    // Push right past each neighbour, then back from the right edge.
    let edge = 4;
    for (const it of items) {
      it.cx = Math.max(it.cx, edge + it.bw / 2);
      edge = it.cx + it.bw / 2 + gap;
    }
    edge = w - 4;
    for (const it of [...items].reverse()) {
      it.cx = Math.min(it.cx, edge - it.bw / 2);
      edge = it.cx - it.bw / 2 - gap;
    }
    return { fs, items };
  }
  return undefined;
}

export function drawRiver(s: River, x0: Ctx, w: number, h: number): string {
  const x: Ctx = { ...x0, fs: Math.min(x0.fs, Math.max(TYPE_FLOOR, Math.round(w / 23))) };
  const geo = RIVERS[s.view];
  // A section sits low, its sky left for the labels (each on a leader); a plan fills the space.
  const plan = s.view === "meander-plan";
  const k = plan ? Math.min(w / 160, h / 100) * 0.92 : (w / 160) * 0.96;
  const ox = (w - 160 * k) / 2;
  // Modern looks: a section's names stand in one row above it, in the order of what they name,
  // each on a straight leader; the section fills the rest of the zone.
  const modern = !plan && look().preset !== "current";
  // A meander section names its features in place (in the water, on the banks); other sections
  // name theirs in a row above.
  const spots = modern && s.view === "meander-section" ? meanderSpots(s, x, k) : undefined;
  const row = modern && !spots ? sectionRow(s, x, w, ox, k) : undefined;
  const band = row
    ? row.fs * 1.25 + row.fs * 0.9
    : spots
      ? s.labels.some((l) => l.part === "outer-bank" || l.part === "inner-bank")
        ? spots.fs * 1.6
        : 4
      : 0;
  // The ground's highest point meets the label band; its base meets the zone's foot.
  const span = 100 - Math.min(100, ...geo.ground.map((p) => p[1]));
  const ky = plan
    ? k
    : row || spots
      ? Math.min(k * 1.6, (h - 2 - band) / Math.max(1, span))
      : (h * 0.6) / 80;
  const oy = plan ? (h - 100 * k) / 2 : h - 100 * ky - 2;
  const t = ([a, b]: Pt): Pt => [ox + a * k, oy + b * ky];
  const WATER = mix("#3a7bc8", x.c.surface, 0.5);
  const sc = scene();
  const out: string[] = [];
  const has = new Set(s.labels.map((l) => l.part));
  if (s.view === "meander-plan") {
    const centre: Pt[] = [[30, 97]];
    for (let i = 0; i <= 48; i++) centre.push(BEND(i / 48));
    centre.push([130, 97]);
    const path = centre.map(t);
    const d = path.map(([a, b], i) => `${i ? "L" : "M"}${n(a)},${n(b)}`).join(" ");
    const width = 16 * k;
    out.push(
      `<path d="${d}" fill="none" stroke="${x.c.ink}" stroke-width="${n(width + 5)}" stroke-linecap="butt" stroke-linejoin="round"/>`,
    );
    out.push(
      `<path d="${d}" fill="none" stroke="${WATER}" stroke-width="${n(width)}" stroke-linecap="butt" stroke-linejoin="round"/>`,
    );
    // Banks as obstacles: the two edges of the channel.
    const edge = (off: number) =>
      centre.map((p, i) => {
        const q = centre[Math.min(centre.length - 1, i + 1)] as Pt;
        const r0 = centre[Math.max(0, i - 1)] as Pt;
        const dx = q[0] - r0[0];
        const dy = q[1] - r0[1];
        const m = Math.hypot(dx, dy) || 1;
        return t([p[0] - (dy / m) * off, p[1] + (dx / m) * off]);
      });
    addLine(x, sc, edge(8.5));
    addLine(x, sc, edge(-8.5));
    if (has.has("slip-off-slope") || has.has("inner-bank")) {
      const [ax, ay] = t([80, 46]);
      out.push(
        `<ellipse cx="${n(ax)}" cy="${n(ay)}" rx="${n(26 * k)}" ry="${n(8 * k)}" fill="${mix("#c9a227", x.c.surface, 0.5)}"/>`,
      );
    }
    if (has.has("fastest-flow")) {
      const line = edge(-4.5).slice(9, 42);
      out.push(
        `<polyline points="${line.map(([a, b]) => `${n(a)},${n(b)}`).join(" ")}" fill="none" stroke="${x.c.accent2}" stroke-width="2.5" stroke-dasharray="7 5"/>`,
      );
    }
    if (has.has("flow-direction")) {
      const [ax, ay] = t([30, 95]);
      const [bx, by] = t([30, 79]);
      out.push(arrow(ax, ay, bx, by, x.c.ink, 3, 11));
      addLine(x, sc, [
        [ax, ay],
        [bx, by],
      ]);
    }
  } else {
    const g = geo.ground.map(t);
    out.push(
      // Modern looks: flat land in a neutral tint; line art draws only the profile.
      look().open
        ? ""
        : `<polygon points="${g.map(([a, b]) => `${n(a)},${n(b)}`).join(" ")}" fill="${look().outlines ? mix("#8a6a3b", x.c.surface, 0.35) : mix(x.c.ink, x.c.surface, x.dark ? 0.16 : 0.1)}" stroke="none"/>`,
    );
    sc.areas.push(g);
    if (geo.water) {
      const wtr = geo.water.map(t);
      out.push(
        `<polygon points="${wtr.map(([a, b]) => `${n(a)},${n(b)}`).join(" ")}" fill="${WATER}" stroke="none"/>`,
      );
      const s0 = wtr[0] as Pt;
      const s1 = wtr[1] as Pt;
      out.push(
        `<line x1="${n(s0[0])}" y1="${n(s0[1])}" x2="${n(s1[0])}" y2="${n(s1[1])}" stroke="#2c64a8" stroke-width="2"/>`,
      );
      addLine(x, sc, [s0, s1]);
    }
    const profile = g.slice(0, g.length - 2);
    out.push(
      look().outlines
        ? `<polyline points="${profile.map(([a, b]) => `${n(a)},${n(b)}`).join(" ")}" fill="none" stroke="${x.c.ink}" stroke-width="2.5" stroke-linejoin="round"/>`
        : "",
    );
    addLine(x, sc, profile);
  }
  out.push(geo.marks(t, x, sc, has));
  if (spots) {
    for (const sp of spots.items) {
      const [px, py] = t(sp.at);
      const lx = sp.anchor === "start" ? px : sp.anchor === "end" ? px - sp.bw : px - sp.bw / 2;
      out.push(
        text(x, px, py, [sp.text], { fs: spots.fs, weight: WEIGHT.name, anchor: sp.anchor }),
      );
      if (sp.leader) {
        // A short leader from the label's nearest edge to its point.
        const [ax, ay] = t(sp.leader);
        const ex = Math.max(lx, Math.min(lx + sp.bw, ax));
        const ey = ay < py - spots.fs * 0.6 ? py - spots.fs * 0.6 : py;
        const sx = ax < lx ? lx - 3 : ax > lx + sp.bw ? lx + sp.bw + 3 : ex;
        out.push(
          `<line x1="${n(sx)}" y1="${n(ey)}" x2="${n(ax)}" y2="${n(ay)}" stroke="${x.c.ink}" stroke-width="${STROKE.hair}" stroke-linecap="round"/>`,
          `<circle cx="${n(ax)}" cy="${n(ay)}" r="3.5" fill="${x.c.ink}"/>`,
        );
        x.leaders?.push([sx, ey, ax, ay]);
      }
    }
    return out.join("");
  }
  if (row) {
    for (const it of row.items) {
      const [ax, ay] = t(geo.anchors[it.part]?.at ?? [0, 0]);
      const ly = row.fs * 1.25 + 4;
      out.push(
        `<line x1="${n(it.cx)}" y1="${n(ly)}" x2="${n(ax)}" y2="${n(ay)}" stroke="${x.c.ink}" stroke-width="${STROKE.hair}" stroke-linecap="round"/>`,
        `<circle cx="${n(ax)}" cy="${n(ay)}" r="3.5" fill="${x.c.ink}"/>`,
      );
      x.strokes?.push([it.cx, ly, ax, ay]);
      x.leaders?.push([it.cx, ly, ax, ay]);
      out.push(
        text(x, it.cx, row.fs * 0.62, [it.text], { fs: row.fs, weight: WEIGHT.name, halo: x.c.bg }),
      );
    }
    return out.join("");
  }
  // The deepest points first (their leaders are the longest), other orders when one is boxed in.
  const order = [...s.labels].sort(
    (p, q) => (geo.anchors[q.part]?.at[1] ?? 0) - (geo.anchors[p.part]?.at[1] ?? 0),
  );
  out.push(
    placeAll(
      x,
      sc,
      w,
      h,
      order.flatMap((l) => {
        const a = geo.anchors[l.part];
        return a
          ? [
              {
                text: l.text,
                at: t(a.at),
                prefer: plan ? a.prefer : ["n", "nw", "ne", ...a.prefer],
                maxW: Math.min(w * 0.34, 170),
              } as LabelReq,
            ]
          : [];
      }),
    ),
  );
  out.push(drawKey(x, sc, w, h));
  return out.join("");
}
