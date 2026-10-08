/**
 * Round 8: equal groups and fraction shapes, drawn from meaning alone. The model says how many
 * counters in how many groups, or how a shape is cut and how many parts are shaded; every counter,
 * ring, part, cut line and label position here is code's, so the picture is right by construction
 *.
 *
 * Each kind has two finishes (`Ctx.finish`): warm for Splash and the KS1-2 themes (soft filled
 * rings, rounded counters with a highlight, a bolder outline) and refined for Studio and the KS3-5
 * themes (hairline rings, flat counters, fine cut lines).
 */

import { finishOf } from "./finish";
import type { EqualGroups, FractionShapes } from "./schema";
import { WEIGHT } from "./style";
import { type Ctx, mix, n, text, textWidth } from "./svg";

const tk = finishOf;

/** Counter centres for `k` counters packed in a unit circle (radius 1), with their radius. */
function packInCircle(k: number): { pts: [number, number][]; r: number } {
  if (k === 1) return { pts: [[0, 0]], r: 0.55 };
  if (k <= 6) {
    const ring = 0.5;
    const r = Math.min(0.42, Math.sin(Math.PI / k) * ring * 0.92);
    return {
      pts: Array.from({ length: k }, (_, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / k;
        return [ring * Math.cos(a), ring * Math.sin(a)] as [number, number];
      }),
      r: Math.max(r, 0.2),
    };
  }
  // 7 and over: one in the middle, the rest round it (up to 8), then an outer ring.
  const inner = Math.min(k - 1, k <= 9 ? k - 1 : 6);
  const pts: [number, number][] = [[0, 0]];
  const r1 = 0.4;
  for (let i = 0; i < inner; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / inner;
    pts.push([r1 * Math.cos(a), r1 * Math.sin(a)]);
  }
  const rest = k - 1 - inner;
  for (let i = 0; i < rest; i++) {
    const a = -Math.PI / 2 + Math.PI / rest + (i * 2 * Math.PI) / rest;
    pts.push([0.76 * Math.cos(a), 0.76 * Math.sin(a)]);
  }
  return { pts, r: rest ? 0.15 : Math.min(0.19, Math.sin(Math.PI / inner) * r1 * 0.9) };
}

function counter(x: Ctx, cx: number, cy: number, r: number, fill: string): string {
  const base = `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}" stroke="${x.c.ink}" stroke-width="${tk(x).stroke.counter}"/>`;
  if (!tk(x).highlight) return base;
  // A soft highlight up and to the left: a counter you could pick up.
  return `${base}<circle cx="${n(cx - r * 0.32)}" cy="${n(cy - r * 0.32)}" r="${n(r * 0.3)}" fill="${x.c.bg}" fill-opacity="${tk(x).highlight}"/>`;
}

/**
 * BAKEOFF base4f (unshared): an equal-groups request whose words say the counters are not shared
 * yet ("Fourteen unshared counters in a single ring, ready for pupils to ... share") is drawn as one
 * pile, so a question slide does not show its own answer (base4-4 y2 "Find half of 14").
 * parseDiagram reads a `pile: true` spec (one group) as drawn.
 */
export const UNSHARED =
  /\b(unshared|not (yet )?shared|before (they are |it is )?shar|ready (for pupils )?to (be )?shar|(in )?(a single|one) (ring|pile|group)|all together|together in one)/i;
const ROW_WORDS = /\b(in (a|one) (row|line)|one row|a row of|in a line|lined up)\b/i;
/** The pile spec (one ring, every counter, no count) for a request that asks for unshared counters. */
export function pileSpec(spec: unknown, words: string): EqualGroups | undefined {
  const s = spec as { kind?: unknown; total?: unknown; alt?: unknown };
  if (s?.kind !== "equal-groups" || typeof s.total !== "number" || !Number.isInteger(s.total))
    return;
  if (s.total < 2 || s.total > 40 || !UNSHARED.test(words)) return;
  return {
    kind: "equal-groups",
    alt: typeof s.alt === "string" ? s.alt : `${s.total} counters, not yet shared.`,
    title: null,
    total: s.total,
    groups: 1,
    // The row the slide describes ("in one row", "in a line"), else a loose pile.
    layout: ROW_WORDS.test(words) ? "rows" : "rings",
    show_count: "none",
    pile: true,
  } as unknown as EqualGroups;
}
/**
 * base4f (D48b): unshared counters fill the panel at a countable size. A row the words describe is
 * one line across the panel (wrapping to two only when one line would shrink them); a pile is a
 * loose block of short rows. No ring: a ring reads as a group, and the task is to make the groups.
 */
function drawPile(total: number, asRow: boolean, x: Ctx, w: number, h: number): string {
  const maxD = Math.max(x.fs * 2.4, 28);
  let best = { rows: 1, cols: total, d: 0 };
  for (let rows = 1; rows <= Math.min(total, asRow ? 2 : 4); rows++) {
    const cols = Math.ceil(total / rows);
    const d = Math.min(maxD, (w * 0.92) / (cols * 1.35), (h * 0.86) / (rows * 1.35));
    // A row stays one line while its counters stay countable (19 units, about 28px at 1440).
    if (asRow && rows > 1 && best.d >= 19) break;
    if (d > best.d) best = { rows, cols, d };
  }
  const { rows, cols, d } = best;
  if (d < 12) {
    x.faults?.push("the groups do not fit the space");
    return "";
  }
  const step = d * 1.35;
  const oy = (h - rows * step) / 2 + step / 2;
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, total - r * cols);
    // A pile is slightly irregular (offset alternate rows), a row is straight.
    const ox = (w - inRow * step) / 2 + step / 2 + (!asRow && r % 2 ? step * 0.18 : 0);
    for (let c = 0; c < inRow; c++)
      out.push(counter(x, ox + c * step, oy + r * step, d / 2, x.c.accent));
  }
  return out.join("");
}

export function drawEqualGroups(s: EqualGroups, x: Ctx, w: number, h: number): string {
  if ((s as { pile?: boolean }).pile && s.groups === 1)
    return drawPile(s.total, s.layout === "rows", x, w, h);
  const per = s.total / s.groups;
  const g = s.groups;
  const out: string[] = [];
  const countText = (i: number) =>
    s.show_count === "none" || (s.show_count === "one" && i > 0)
      ? undefined
      : s.unknown
        ? "?"
        : String(per);
  const fs = x.fs;
  const ft = tk(x);
  const ring = ft.wash.ring ? mix(x.c.accent, x.c.bg, ft.wash.ring) : "none";
  const ringLine = x.c[ft.ringRole];
  const ringW = ft.stroke.ring;
  if (s.layout === "rows") {
    // Each group a row of counters in a rounded band, its count to the right of the band.
    const labelW = textWidth(s.unknown ? "?" : String(per), x, fs, WEIGHT.name) + fs;
    const gap = Math.max(6, fs * 0.4);
    const bandH = Math.min((h - gap * (g - 1)) / g, fs * 2.6);
    const d = Math.min(bandH * 0.72, (w - labelW - fs) / (per * 1.25));
    if (d < 8 || bandH < 12) {
      x.faults?.push("the groups do not fit the space");
      return "";
    }
    const bandW = per * d * 1.25 + d * 0.4;
    const ox = (w - bandW - labelW) / 2;
    const oy = (h - (g * bandH + (g - 1) * gap)) / 2;
    for (let i = 0; i < g; i++) {
      const y = oy + i * (bandH + gap);
      out.push(
        `<rect x="${n(ox)}" y="${n(y)}" width="${n(bandW)}" height="${n(bandH)}" rx="${n(bandH / 2)}" fill="${ring}" stroke="${ringLine}" stroke-width="${ringW}"/>`,
      );
      x.strokes?.push([ox, y, ox + bandW, y], [ox, y + bandH, ox + bandW, y + bandH]);
      for (let j = 0; j < per; j++)
        out.push(counter(x, ox + d * 0.7 + j * d * 1.25, y + bandH / 2, d / 2, x.c.accent));
      const t = countText(i);
      if (t)
        out.push(
          text(x, ox + bandW + fs * 0.5, y + bandH / 2, [t], {
            anchor: "start",
            fs,
            weight: WEIGHT.name,
          }),
        );
    }
    return out.join("");
  }
  // Rings: a grid of rings, as square as the zone allows; each count under its ring, outside it.
  let best: { cols: number; rows: number; R: number } | undefined;
  for (let cols = 1; cols <= g; cols++) {
    const rows = Math.ceil(g / cols);
    const cellW = w / cols;
    const cellH = h / rows;
    const R = Math.min(cellW * 0.42, (cellH - fs * 1.5) * 0.46);
    if (!best || R > best.R) best = { cols, rows, R };
  }
  if (!best || best.R < fs * 1.1) {
    x.faults?.push("the groups do not fit the space");
    return "";
  }
  const { cols, rows, R } = best;
  const cellW = w / cols;
  const cellH = Math.min(h / rows, (2 * R) / 0.92 + fs * 1.6);
  const oy = (h - rows * cellH) / 2;
  const pack = packInCircle(per);
  for (let i = 0; i < g; i++) {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, g - row * cols);
    const ox = (w - inRow * cellW) / 2;
    const cx = ox + (i % cols) * cellW + cellW / 2;
    const cy = oy + row * cellH + R + 2;
    out.push(
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}" fill="${ring}" stroke="${ringLine}" stroke-width="${ringW}"${ft.ringDash ? ` stroke-dasharray="${ft.ringDash}"` : ""}/>`,
    );
    x.strokes?.push([cx - R, cy + R, cx + R, cy + R]);
    for (const [px, py] of pack.pts)
      out.push(counter(x, cx + px * R * 0.86, cy + py * R * 0.86, pack.r * R * 0.86, x.c.accent));
    const t = countText(i);
    if (t)
      out.push(
        text(x, cx, cy + R + fs * 0.25, [t], { v: "top", fs, weight: WEIGHT.name, fill: x.c.ink }),
      );
  }
  return out.join("");
}

// ─── fraction shapes ────────────────────────────────────────────────────────────────────────

const GRID: Record<number, [number, number]> = {
  4: [2, 2],
  6: [3, 2],
  8: [4, 2],
  9: [3, 3],
  12: [4, 3],
};

type Part = string; // an SVG path for one part

function partsOf(
  sh: FractionShapes["shapes"][number],
  x0: number,
  y0: number,
  W: number,
  H: number,
): { parts: Part[]; outline: string } {
  const k = sh.parts;
  const rect = (a: number, b: number, c: number, d: number) =>
    `M${n(a)},${n(b)} H${n(a + c)} V${n(b + d)} H${n(a)} Z`;
  if (sh.shape === "circle") {
    const r = Math.min(W, H) / 2;
    const cx = x0 + W / 2;
    const cy = y0 + H / 2;
    const pt = (i: number) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / k;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    const parts = Array.from({ length: k }, (_, i) => {
      const [ax, ay] = pt(i) as [number, number];
      const [bx, by] = pt(i + 1) as [number, number];
      return `M${n(cx)},${n(cy)} L${n(ax)},${n(ay)} A${n(r)},${n(r)} 0 0 1 ${n(bx)},${n(by)} Z`;
    });
    return {
      parts,
      outline: `M${n(cx - r)},${n(cy)} A${n(r)},${n(r)} 0 1 1 ${n(cx + r)},${n(cy)} A${n(r)},${n(r)} 0 1 1 ${n(cx - r)},${n(cy)} Z`,
    };
  }
  const outline = rect(x0, y0, W, H);
  const cut =
    sh.cut !== "auto"
      ? sh.cut
      : sh.shape === "square" && GRID[k] && k !== 8 && k !== 12
        ? "grid"
        : "vertical";
  if (cut === "diagonal") {
    const cx = x0 + W / 2;
    const cy = y0 + H / 2;
    const c = [
      [x0, y0],
      [x0 + W, y0],
      [x0 + W, y0 + H],
      [x0, y0 + H],
    ] as const;
    const P = (p: readonly number[] | undefined) =>
      p ? `${n(p[0] as number)},${n(p[1] as number)}` : "0,0";
    if (k === 2)
      return {
        parts: [`M${P(c[0])} L${P(c[1])} L${P(c[3])} Z`, `M${P(c[1])} L${P(c[2])} L${P(c[3])} Z`],
        outline,
      };
    return {
      parts: [0, 1, 2, 3].map((i) => `M${n(cx)},${n(cy)} L${P(c[i])} L${P(c[(i + 1) % 4])} Z`),
      outline,
    };
  }
  if (cut === "grid" && GRID[k]) {
    const [gc, gr] = (W >= H ? GRID[k] : [GRID[k]?.[1], GRID[k]?.[0]]) as [number, number];
    const parts: Part[] = [];
    for (let r = 0; r < gr; r++)
      for (let c = 0; c < gc; c++)
        parts.push(rect(x0 + (c * W) / gc, y0 + (r * H) / gr, W / gc, H / gr));
    return { parts, outline };
  }
  if (cut === "horizontal")
    return {
      parts: Array.from({ length: k }, (_, i) => rect(x0, y0 + (i * H) / k, W, H / k)),
      outline,
    };
  return {
    parts: Array.from({ length: k }, (_, i) => rect(x0 + (i * W) / k, y0, W / k, H)),
    outline,
  };
}

export function drawFractionShapes(s: FractionShapes, x: Ctx, w: number, h: number): string {
  const k = s.shapes.length;
  const fs = x.fs;
  const named = s.shapes.some((sh) => sh.name);
  const nameH = named ? fs * 1.6 : 0;
  const gap = Math.max(fs, w * 0.05);
  const colW = (w - gap * (k - 1)) / k;
  const roomH = h - nameH - 4;
  if (colW < fs * 2.5 || roomH < fs * 2.5) {
    x.faults?.push("the shapes do not fit the space");
    return "";
  }
  const out: string[] = [];
  const t = tk(x);
  const line = t.stroke.outline;
  const cutW = t.stroke.cut;
  const shade = mix(x.c.accent, x.c.bg, t.wash.shaded);
  const blank = t.wash.blank ? mix(x.c.accent, x.c.bg, t.wash.blank) : x.c.bg;
  s.shapes.forEach((sh, i) => {
    const aspect = sh.shape === "bar" ? 4 : sh.shape === "rectangle" ? 1.6 : 1;
    let W = Math.min(colW, roomH * aspect);
    let H = W / aspect;
    if (H > roomH) {
      H = roomH;
      W = H * aspect;
    }
    const x0 = i * (colW + gap) + (colW - W) / 2;
    const y0 = (roomH - H) / 2 + 2;
    const { parts, outline } = partsOf(sh, x0, y0, W, H);
    // Fill and boundary are separate marks: a look that drops the outline of a filled shape
    // (flat) would otherwise erase the cuts, and A, B and C would read as whole shapes. Each part's
    // boundary is an open ink line on a ground-coloured halo, so a cut between two shaded parts shows.
    parts.forEach((d, j) => {
      out.push(
        `<path d="${d}" fill="${j < sh.shaded ? shade : blank}" stroke="${x.c.ink}" stroke-width="${cutW}" stroke-linejoin="round"/>`,
      );
    });
    parts.forEach((d) => {
      out.push(
        `<path d="${d}" fill="none" stroke="${x.c.bg}" stroke-width="${n(cutW + 2.5)}" stroke-linejoin="round"/>`,
        `<path d="${d}" fill="none" stroke="${x.c.ink}" stroke-width="${cutW}" stroke-linejoin="round"/>`,
      );
    });
    out.push(
      `<path d="${outline}" fill="none" stroke="${x.c.ink}" stroke-width="${line}" stroke-linejoin="round"/>`,
    );
    x.strokes?.push([x0, y0 + H, x0 + W, y0 + H]);
    if (sh.name)
      out.push(
        text(x, x0 + W / 2, y0 + H + fs * 0.35, [sh.name], {
          v: "top",
          fs,
          weight: WEIGHT.name,
          fill: x.c.ink,
        }),
      );
  });
  return out.join("");
}
