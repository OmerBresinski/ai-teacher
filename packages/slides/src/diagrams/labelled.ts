/**
 * Labelled diagrams: simple primitives on a 100-unit-high canvas (100 or 160 wide), scaled evenly
 * into the room the labels leave, with leader-line labels stacked in the margins so none overlap.
 * Particle boxes draw solids, liquids and gases the way a science textbook does, deterministically.
 */
import type { LabelledDiagram } from "./schema";
import { arrow, type Ctx, n, text, textWidth, toneFill } from "./svg";

type Shape = LabelledDiagram["shapes"][number];
type Particles = Extract<Shape, { type: "particles" }>;

/** Gas particle centres in a unit box: spread out, none touching, fixed. */
const GAS: [number, number][] = [
  [0.18, 0.2],
  [0.62, 0.14],
  [0.86, 0.42],
  [0.4, 0.46],
  [0.14, 0.72],
  [0.7, 0.8],
  [0.44, 0.86],
  [0.9, 0.9],
];

/** Particle centres and radius, in canvas units, for a box. */
export function particleCentres(p: Particles): { r: number; at: [number, number][] } {
  const pad = 1.5;
  const bw = p.w - 2 * pad;
  const bh = p.h - 2 * pad;
  if (p.arrangement === "gas") {
    const r = Math.min(bw, bh) / 14;
    return {
      r,
      at: GAS.map(([u, v]) => [p.x + pad + r + u * (bw - 2 * r), p.y + pad + r + v * (bh - 2 * r)]),
    };
  }
  const cols = 6;
  const r = Math.min(bw / cols, bh / 4) / 2;
  const d = 2 * r;
  const at: [number, number][] = [];
  if (p.arrangement === "solid") {
    const rows = Math.max(3, Math.min(8, Math.floor(bh / d)));
    const ox = p.x + pad + (bw - cols * d) / 2 + r;
    const oy = p.y + p.h - pad - r;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) at.push([ox + i * d, oy - j * d]);
    return { r, at };
  }
  // Liquid: touching, but in no pattern, settled at the bottom, a few gaps. Offsets are fixed.
  const jig = [0.18, -0.22, 0.3, -0.1, 0.05, -0.3, 0.24, -0.16];
  const skip = new Set([4, 9, 15, 20]);
  const rows = Math.max(3, Math.min(5, Math.floor((bh * 0.8) / (d * 0.9))));
  const ox = p.x + pad + r;
  const oy = p.y + p.h - pad - r;
  const perRow = cols - 1;
  let k = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < perRow; i++, k++) {
      if (skip.has(k)) continue;
      const jx = (jig[k % jig.length] ?? 0) * r * 0.25 + (j % 2 ? r : 0);
      const jy = (jig[(k + 3) % jig.length] ?? 0) * r * 0.2;
      const cx = Math.min(p.x + p.w - pad - r, ox + i * d * 1.12 + jx);
      at.push([cx, oy - j * d * 0.95 + jy]);
    }
  }
  return { r, at };
}

export function drawLabelled(s: LabelledDiagram, x: Ctx, w: number, h: number): string {
  const { c, fs } = x;
  const W = s.canvas === "wide" ? 160 : 100;
  const H = 100;
  const small = Math.max(14, Math.round(fs * 0.9));
  const side = (k: "left" | "right" | "top" | "bottom") => s.labels.filter((l) => l.side === k);
  const widest = (k: "left" | "right") =>
    Math.max(0, ...side(k).map((l) => textWidth(l.text, x, small, 600)));
  const lead = fs * 1.2;
  const mL = side("left").length ? widest("left") + lead : 4;
  const mR = side("right").length ? widest("right") + lead : 4;
  const mT = side("top").length ? small * 1.6 + lead * 0.6 : 4;
  const hasCaption = s.shapes.some((sh) => sh.type === "particles" && sh.caption);
  const mB =
    (side("bottom").length ? small * 1.6 + lead * 0.6 : 4) + (hasCaption ? small * 1.5 : 0);
  const k = Math.max(0.1, Math.min((w - mL - mR) / W, (h - mT - mB) / H));
  const ox = mL + (w - mL - mR - W * k) / 2;
  const oy = mT + (h - mT - mB - H * k) / 2;
  const X = (u: number) => ox + u * k;
  const Y = (v: number) => oy + v * k;
  const stroke = `stroke="${c.ink}" stroke-width="2.5" stroke-linejoin="round"`;
  const out: string[] = [];

  for (const sh of s.shapes) {
    switch (sh.type) {
      case "circle":
        out.push(
          `<circle cx="${n(X(sh.cx))}" cy="${n(Y(sh.cy))}" r="${n(sh.r * k)}" fill="${toneFill(c, sh.fill)}" ${stroke}/>`,
        );
        break;
      case "ellipse":
        out.push(
          `<ellipse cx="${n(X(sh.cx))}" cy="${n(Y(sh.cy))}" rx="${n(sh.rx * k)}" ry="${n(sh.ry * k)}" fill="${toneFill(c, sh.fill)}" ${stroke}/>`,
        );
        break;
      case "rect":
        out.push(
          `<rect x="${n(X(sh.x))}" y="${n(Y(sh.y))}" width="${n(sh.w * k)}" height="${n(sh.h * k)}"${sh.rounded ? ` rx="${n(Math.min(sh.w, sh.h) * k * 0.2)}"` : ""} fill="${toneFill(c, sh.fill)}" ${stroke}/>`,
        );
        break;
      case "polygon":
        out.push(
          `<polygon points="${sh.points.map(([u, v]) => `${n(X(u))},${n(Y(v))}`).join(" ")}" fill="${toneFill(c, sh.fill)}" ${stroke}/>`,
        );
        break;
      case "line":
        out.push(
          `<polyline points="${sh.points.map(([u, v]) => `${n(X(u))},${n(Y(v))}`).join(" ")}" fill="none" ${stroke}${sh.dashed ? ` stroke-dasharray="${n(fs * 0.5)} ${n(fs * 0.35)}"` : ""} stroke-linecap="round"/>`,
        );
        break;
      case "arrow":
        out.push(arrow(X(sh.from[0]), Y(sh.from[1]), X(sh.to[0]), Y(sh.to[1]), c.ink, 3, fs * 0.8));
        break;
      case "particles": {
        const { r, at } = particleCentres(sh);
        out.push(
          `<rect x="${n(X(sh.x))}" y="${n(Y(sh.y))}" width="${n(sh.w * k)}" height="${n(sh.h * k)}" fill="${c.surface}" stroke="${c.muted}" stroke-width="2"/>`,
        );
        for (const [u, v] of at) {
          out.push(
            `<circle cx="${n(X(u))}" cy="${n(Y(v))}" r="${n(r * k * 0.94)}" fill="${c.accent}" stroke="${c.ink}" stroke-width="1.5"/>`,
          );
        }
        if (sh.caption) {
          out.push(
            text(x, X(sh.x + sh.w / 2), Y(sh.y + sh.h) + 6, [sh.caption], {
              v: "top",
              weight: 600,
            }),
          );
        }
        break;
      }
    }
  }

  // Labels: stacked along each margin in the order of the points they name, a line apart at least.
  const spread = (want: number[], min: number, lo: number, hi: number) => {
    const got = [...want];
    for (let i = 1; i < got.length; i++) got[i] = Math.max(got[i] ?? 0, (got[i - 1] ?? 0) + min);
    const over = (got[got.length - 1] ?? 0) - hi;
    if (over > 0) for (let i = 0; i < got.length; i++) got[i] = (got[i] ?? 0) - over;
    for (let i = 0; i < got.length; i++) got[i] = Math.max(got[i] ?? 0, lo + i * min);
    return got;
  };
  const dot = (px: number, py: number) =>
    `<circle cx="${n(px)}" cy="${n(py)}" r="${n(Math.max(3, fs * 0.2))}" fill="${c.ink}" stroke="${c.bg}" stroke-width="1.5"/>`;
  const leader = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${c.ink}" stroke-width="1.5"/>`;
  for (const k2 of ["left", "right"] as const) {
    const ls = side(k2).sort((a, b) => a.at[1] - b.at[1]);
    const ys = spread(
      ls.map((l) => Y(l.at[1])),
      small * 1.35,
      small,
      h - small,
    );
    ls.forEach((l, i) => {
      const py = ys[i] ?? 0;
      const tx = k2 === "left" ? mL - lead * 0.4 : w - mR + lead * 0.4;
      const ex = k2 === "left" ? tx + 4 : tx - 4;
      out.push(
        leader(ex, py, X(l.at[0]), Y(l.at[1])),
        dot(X(l.at[0]), Y(l.at[1])),
        text(x, k2 === "left" ? tx - 2 : tx + 2, py, [l.text], {
          anchor: k2 === "left" ? "end" : "start",
          fs: small,
          weight: 600,
        }),
      );
    });
  }
  for (const k2 of ["top", "bottom"] as const) {
    const ls = side(k2).sort((a, b) => a.at[0] - b.at[0]);
    // A row of labels wider than the drawing is set smaller until it fits, never pushed off an edge.
    let rowFs = small;
    const widthsAt = (f: number) => ls.map((l) => textWidth(l.text, x, f, 600) + f);
    let widths = widthsAt(rowFs);
    while (rowFs > 11 && widths.reduce((a, b) => a + b, 0) > w) {
      rowFs -= 1;
      widths = widthsAt(rowFs);
    }
    const xs: number[] = [];
    ls.forEach((l, i) => {
      const want = X(l.at[0]);
      const prev = xs[i - 1];
      const half = (widths[i] ?? 0) / 2;
      const min = prev === undefined ? half : prev + (widths[i - 1] ?? 0) / 2 + half;
      xs.push(Math.max(want, min));
    });
    const lastX = xs[xs.length - 1];
    const lastW = widths[widths.length - 1] ?? 0;
    if (lastX !== undefined && lastX + lastW / 2 > w) {
      const shift = Math.min(lastX + lastW / 2 - w, (xs[0] ?? 0) - (widths[0] ?? 0) / 2);
      for (let i = 0; i < xs.length; i++) xs[i] = (xs[i] ?? 0) - Math.max(0, shift);
    }
    ls.forEach((l, i) => {
      const px = xs[i] ?? 0;
      const ty = k2 === "top" ? small * 0.2 : h - small * 0.2;
      const ly = k2 === "top" ? ty + rowFs * 1.3 : ty - rowFs * 1.3;
      out.push(
        leader(px, ly, X(l.at[0]), Y(l.at[1])),
        dot(X(l.at[0]), Y(l.at[1])),
        text(x, px, ty, [l.text], { v: k2 === "top" ? "top" : "bottom", fs: rowFs, weight: 600 }),
      );
    });
  }
  return out.join("");
}
