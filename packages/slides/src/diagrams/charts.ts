/**
 * DIAGRAM-AUDIT coverage quick wins: the category bar chart (with pictogram and tally variants),
 * the pie chart (and the shaded fraction circle), and the Venn and Carroll diagrams. Code owns the
 * geometry; the writer gives categories, values and items. Pure string building on the shared kit.
 */
import { z } from "zod";
import { STROKE, sub, TYPE_FLOOR, WEIGHT } from "./style";
import { type Ctx, mix, n, num, text, textWidth, ticks, wrap } from "./svg";

const label = (max: number) => z.string().trim().min(1).max(max);
const common = { alt: label(200), title: label(40).optional() };

export const BarChartSchema = z.object({
  kind: z.literal("bar-chart"),
  ...common,
  /** bars; pictogram: a symbol per `per` units (half symbols allowed); tally: tally marks. */
  style: z.enum(["bars", "pictogram", "tally"]).default("bars"),
  x: z.object({ label: label(30) }).optional(),
  y: z.object({ label: label(30) }).optional(),
  bars: z
    .array(z.object({ label: label(16), value: z.number().nonnegative().finite() }))
    .min(1)
    .max(8),
  /** Pictogram: what one symbol stands for (default 1). */
  per: z.number().positive().finite().optional(),
});

export const PieSchema = z
  .object({
    kind: z.literal("pie"),
    ...common,
    /** A pie chart: each slice in proportion to its value, named by its label. */
    slices: z
      .array(z.object({ label: label(20), value: z.number().positive().finite() }))
      .min(2)
      .max(6)
      .optional(),
    /** A fraction circle: `parts` equal parts, the first `shaded` of them shaded. */
    parts: z.number().int().min(2).max(12).optional(),
    shaded: z.number().int().min(0).max(12).optional(),
  })
  .refine(
    (p) => !!p.slices !== (p.parts !== undefined),
    "give slices, or parts (a fraction circle)",
  )
  .refine((p) => p.parts === undefined || (p.shaded ?? 0) <= p.parts, "shaded is at most parts");

export const VennSchema = z.object({
  kind: z.literal("venn"),
  ...common,
  sets: z.array(label(20)).min(2).max(3),
  /** Each item and the sets it belongs to (0-based; none: outside every set). */
  items: z
    .array(z.object({ text: label(16), in: z.array(z.number().int().min(0).max(2)).max(3) }))
    .max(12)
    .default([]),
});

export const CarrollSchema = z.object({
  kind: z.literal("carroll"),
  ...common,
  /** The two row headings (a property and its opposite), then the two column headings. */
  rows: z.tuple([label(18), label(18)]),
  cols: z.tuple([label(18), label(18)]),
  /** The items in each cell, row by row. */
  cells: z.tuple([
    z.tuple([z.array(label(16)).max(5), z.array(label(16)).max(5)]),
    z.tuple([z.array(label(16)).max(5), z.array(label(16)).max(5)]),
  ]),
});

export type BarChart = z.infer<typeof BarChartSchema>;
export type Pie = z.infer<typeof PieSchema>;
export type Venn = z.infer<typeof VennSchema>;
export type Carroll = z.infer<typeof CarrollSchema>;

const bad = (x: Ctx, why: string) => x.faults?.push(why);

// ─── bar chart ──────────────────────────────────────────────────────────────────────────────

export function drawBarChart(s: BarChart, x: Ctx, w: number, h: number): string {
  const { c } = x;
  const fs = x.fs;
  const small = sub(fs);
  const k = s.bars.length;
  const out: string[] = [];
  const top = Math.max(...s.bars.map((b) => b.value));
  // Category names under the bars, wrapped to two lines at the floor before anything is cut.
  let cfs = small;
  const slotW0 = (w - small * 4) / k;
  const fits = (f: number) =>
    s.bars.every(
      (b) =>
        !wrap(b.label, x, slotW0 - 6, 2, f)
          .at(-1)
          ?.endsWith("…"),
    );
  while (cfs > TYPE_FLOOR && !fits(cfs)) cfs -= 1;
  if (!fits(cfs)) bad(x, "the bar chart's category names do not fit");
  const catLines = Math.max(...s.bars.map((b) => wrap(b.label, x, slotW0 - 6, 2, cfs).length));
  if (s.style === "bars") {
    const tv = ticks(0, top > 0 ? top : 1, undefined, 5);
    const yMax = Math.max(tv[tv.length - 1] ?? 1, top);
    const tw = Math.max(...tv.map((v) => textWidth(num(v), x, small)));
    const L = (s.y ? fs * 1.3 : 0) + tw + 10;
    const B = catLines * cfs * 1.2 + 8 + (s.x ? fs * 1.4 : 0);
    const T = small * 0.8;
    const pw = w - L - 6;
    const ph = h - T - B;
    if (ph < 80) bad(x, "the bar chart's plot is squashed");
    const Y = (v: number) => T + ph - (v / yMax) * ph;
    for (const v of tv) {
      out.push(
        `<line x1="${n(L)}" y1="${n(Y(v))}" x2="${n(L + pw)}" y2="${n(Y(v))}" stroke="${mix(c.ink, c.bg, 0.18)}" stroke-width="${STROKE.hair}"/>`,
      );
      out.push(text(x, L - 8, Y(v), [num(v)], { fs: small, anchor: "end", weight: WEIGHT.value }));
    }
    const slot = pw / k;
    const bw = Math.min(slot * 0.62, fs * 4);
    s.bars.forEach((b, i) => {
      const cx = L + slot * (i + 0.5);
      out.push(
        `<rect x="${n(cx - bw / 2)}" y="${n(Y(b.value))}" width="${n(bw)}" height="${n(Y(0) - Y(b.value))}" fill="${x.dark ? x.c.tint : mix(c.accent, c.surface, 0.55)}" stroke="${c.accent}" stroke-width="${STROKE.line}"/>`,
      );
      out.push(text(x, cx, Y(0) + 6, wrap(b.label, x, slot - 6, 2, cfs), { fs: cfs, v: "top" }));
    });
    out.push(
      `<line x1="${n(L)}" y1="${n(T)}" x2="${n(L)}" y2="${n(Y(0))}" stroke="${c.ink}" stroke-width="${STROKE.line}"/><line x1="${n(L)}" y1="${n(Y(0))}" x2="${n(L + pw)}" y2="${n(Y(0))}" stroke="${c.ink}" stroke-width="${STROKE.line}"/>`,
    );
    x.strokes?.push([L, Y(0), L + pw, Y(0)], [L, T, L, Y(0)]);
    if (s.x)
      out.push(text(x, L + pw / 2, h - 2, [s.x.label], { v: "bottom", weight: WEIGHT.value }));
    if (s.y)
      out.push(
        `<text transform="rotate(-90 ${n(fs * 0.7)} ${n(T + ph / 2)})" x="${n(fs * 0.7)}" y="${n(T + ph / 2 + fs * 0.35)}" font-family="${x.body}" font-size="${fs}" font-weight="${WEIGHT.value}" fill="${c.ink}" text-anchor="middle">${s.y.label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`,
      );
    return out.join("");
  }
  // Pictogram and tally: one row per category, the name left, the symbols right.
  const per = s.style === "pictogram" ? (s.per ?? 1) : 1;
  const nameW = Math.min(w * 0.34, Math.max(...s.bars.map((b) => textWidth(b.label, x, fs))) + 12);
  const keyH = s.style === "pictogram" ? fs * 1.6 : 0;
  const row = Math.min((h - keyH) / k, fs * 2.4);
  const area = w - nameW - 8;
  const unit =
    s.style === "pictogram" ? Math.min(row * 0.8, area / Math.max(1, Math.ceil(top / per))) : 0;
  const tallyW = (v: number) => Math.ceil(v / 5) * fs * 1.6;
  if (s.style === "pictogram" && unit < fs * 0.9)
    bad(x, "the pictogram's symbols are too small; raise `per`");
  if (s.style === "tally" && Math.max(...s.bars.map((b) => tallyW(b.value))) > area)
    bad(x, "the tally marks do not fit");
  const sym = (cx: number, cy: number, r: number, frac = 1) =>
    frac >= 1
      ? `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${c.accent}" stroke="${c.ink}" stroke-width="${STROKE.hair}"/>`
      : `<path d="M${n(cx)},${n(cy - r)} A${n(r)},${n(r)} 0 0 0 ${n(cx)},${n(cy + r)} Z" fill="${c.accent}" stroke="${c.ink}" stroke-width="${STROKE.hair}"/>`;
  s.bars.forEach((b, i) => {
    const cy = row * (i + 0.5);
    out.push(text(x, nameW - 10, cy, [b.label], { anchor: "end" }));
    if (s.style === "pictogram") {
      const whole = Math.floor(b.value / per);
      const part = b.value / per - whole;
      for (let j = 0; j < whole; j++) out.push(sym(nameW + unit * (j + 0.5), cy, unit * 0.42));
      if (part > 0.01) out.push(sym(nameW + unit * (whole + 0.5), cy, unit * 0.42, part));
    } else {
      const gH = fs * 0.75;
      for (let g = 0; g < Math.ceil(b.value / 5); g++) {
        const marks = Math.min(5, b.value - g * 5);
        const gx = nameW + g * fs * 1.6;
        for (let m = 0; m < Math.min(4, marks); m++)
          out.push(
            `<line x1="${n(gx + m * fs * 0.28)}" y1="${n(cy - gH)}" x2="${n(gx + m * fs * 0.28)}" y2="${n(cy + gH)}" stroke="${c.ink}" stroke-width="${STROKE.line}" stroke-linecap="round"/>`,
          );
        if (marks === 5)
          out.push(
            `<line x1="${n(gx - fs * 0.15)}" y1="${n(cy + gH * 0.7)}" x2="${n(gx + fs * 1.0)}" y2="${n(cy - gH * 0.7)}" stroke="${c.ink}" stroke-width="${STROKE.line}" stroke-linecap="round"/>`,
          );
      }
    }
  });
  if (s.style === "pictogram") {
    const ky = h - keyH / 2;
    out.push(sym(nameW + unit * 0.5, ky, Math.min(unit, fs) * 0.42));
    out.push(
      text(x, nameW + unit + 8, ky, [`= ${num(per)}`], { anchor: "start", weight: WEIGHT.value }),
    );
  }
  return out.join("");
}

// ─── pie chart and fraction circle ────────────────────────────────────────────────────────

export function drawPie(s: Pie, x: Ctx, w: number, h: number): string {
  const { c } = x;
  const out: string[] = [];
  const fills = [
    c.accent,
    c.accent2,
    mix(c.accent, c.surface, 0.45),
    mix(c.accent2, c.surface, 0.45),
    mix(c.ink, c.surface, 0.35),
    c.surface,
  ];
  const at = (cx: number, cy: number, r: number, a: number) =>
    [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;
  const wedge = (cx: number, cy: number, r: number, a0: number, a1: number, fill: string) => {
    if (a1 - a0 >= 2 * Math.PI - 1e-6)
      return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}" stroke="${c.ink}" stroke-width="${STROKE.line}"/>`;
    const [x0, y0] = at(cx, cy, r, a0);
    const [x1, y1] = at(cx, cy, r, a1);
    return `<path d="M${n(cx)},${n(cy)} L${n(x0)},${n(y0)} A${n(r)},${n(r)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${n(x1)},${n(y1)} Z" fill="${fill}" stroke="${c.ink}" stroke-width="${STROKE.line}" stroke-linejoin="round"/>`;
  };
  if (!s.slices) {
    const parts = s.parts ?? 2;
    const r = Math.min(w, h) / 2 - 6;
    const cx = w / 2;
    const cy = h / 2;
    for (let i = 0; i < parts; i++)
      out.push(
        wedge(
          cx,
          cy,
          r,
          (i / parts) * 2 * Math.PI,
          ((i + 1) / parts) * 2 * Math.PI,
          i < (s.shaded ?? 0) ? c.accent : c.surface,
        ),
      );
    return out.join("");
  }
  // A key beside the pie: one swatch and name per slice, with its share.
  const total = s.slices.reduce((a, b) => a + b.value, 0);
  const fs = x.fs;
  const rows = s.slices.map((sl) => `${sl.label} (${Math.round((sl.value / total) * 100)}%)`);
  const keyW = Math.max(...rows.map((r) => textWidth(r, x, fs))) + fs * 1.6;
  const rowH = fs * 1.5;
  // The key beside the pie when it fits there, else under it (a half-slide slot).
  const sideR = Math.min((w - keyW - 26) / 2, h / 2 - 6);
  const beside = sideR >= fs * 3.5;
  const r = beside ? sideR : Math.min(w / 2 - 6, (h - rowH * rows.length - 12) / 2);
  if (r < fs * 2.5) bad(x, "the pie is too small beside its key");
  const cx = beside ? r + 6 : w / 2;
  const cy = beside ? h / 2 : r + 4;
  let a = 0;
  s.slices.forEach((sl, i) => {
    const a1 = a + (sl.value / total) * 2 * Math.PI;
    out.push(wedge(cx, cy, r, a, a1, fills[i % fills.length] as string));
    a = a1;
  });
  const kx = beside ? cx + r + 16 : Math.max(4, (w - keyW) / 2);
  const ky0 = beside ? cy - (rowH * rows.length) / 2 : 2 * r + 12;
  rows.forEach((t, i) => {
    const y = ky0 + rowH * (i + 0.5);
    out.push(
      `<rect x="${n(kx)}" y="${n(y - fs * 0.4)}" width="${n(fs * 0.8)}" height="${n(fs * 0.8)}" rx="3" fill="${fills[i % fills.length]}" stroke="${c.ink}" stroke-width="${STROKE.hair}"/>`,
    );
    out.push(text(x, kx + fs * 1.2, y, [t], { anchor: "start" }));
  });
  if (kx + keyW > w + 2) bad(x, "the pie's key runs off the drawing");
  return out.join("");
}

// ─── Venn and Carroll ─────────────────────────────────────────────────────────────────────

export function drawVenn(s: Venn, x: Ctx, w: number, h: number): string {
  const { c } = x;
  const fs = x.fs;
  const out: string[] = [];
  const three = s.sets.length === 3;
  const head = fs * 1.5;
  const r = three ? Math.min(w / 3.1, (h - head) / 2.9) : Math.min(w / 3.3, (h - head) / 2.1);
  const cy = head + (three ? r * 1.0 : (h - head) / 2);
  const centres: [number, number][] = three
    ? [
        [w / 2 - r * 0.55, cy],
        [w / 2 + r * 0.55, cy],
        [w / 2, cy + r * 0.9],
      ]
    : [
        [w / 2 - r * 0.6, cy],
        [w / 2 + r * 0.6, cy],
      ];
  out.push(
    `<rect x="1" y="1" width="${n(w - 2)}" height="${n(h - 2)}" rx="8" fill="none" stroke="${c.ink}" stroke-width="${STROKE.line}"/>`,
  );
  const fills = [c.accent, c.accent2, c.ink];
  centres.forEach(([px, py], i) => {
    out.push(
      `<circle cx="${n(px)}" cy="${n(py)}" r="${n(r)}" fill="${fills[i]}" fill-opacity="${x.dark ? 0.16 : 0.12}" stroke="${fills[i] === c.ink ? c.ink : fills[i]}" stroke-width="${STROKE.line}"/>`,
    );
  });
  // Set names over their circles (the third under it).
  s.sets.forEach((name, i) => {
    const [px, py] = centres[i] as [number, number];
    const below = i === 2;
    const ax = i === 0 ? px - r * 0.3 : i === 1 ? px + r * 0.3 : px;
    out.push(
      text(
        x,
        Math.max(
          textWidth(name, x, fs, WEIGHT.value) / 2 + 4,
          Math.min(w - textWidth(name, x, fs, WEIGHT.value) / 2 - 4, ax),
        ),
        below ? Math.min(h - fs * 0.7, py + r + fs * 0.8) : py - r - fs * 0.6,
        [name],
        { weight: WEIGHT.value },
      ),
    );
  });
  // Each region's anchor: the centroid of the circles it is in, pushed away from the others.
  const region = (ins: number[]): [number, number] => {
    if (ins.length === 0) return [w - fs * 2.5, h - fs * 1.2];
    const pts = ins.map((i) => centres[i] as [number, number]);
    let ax = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    let ay = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    centres.forEach((p, i) => {
      if (ins.includes(i)) return;
      const dx = ax - p[0];
      const dy = ay - p[1];
      const d = Math.hypot(dx, dy) || 1;
      ax += (dx / d) * r * (ins.length === 1 ? 0.45 : 0.25);
      ay += (dy / d) * r * (ins.length === 1 ? 0.45 : 0.25);
    });
    return [ax, ay];
  };
  const groups = new Map<string, string[]>();
  for (const it of s.items) {
    const key = [...new Set(it.in)]
      .filter((i) => i < s.sets.length)
      .sort()
      .join(",");
    groups.set(key, [...(groups.get(key) ?? []), it.text]);
  }
  const ifs = sub(fs, 0.9);
  for (const [key, items] of groups) {
    const ins = key ? key.split(",").map(Number) : [];
    const [ax, ay] = region(ins);
    const lh = ifs * 1.2;
    items.forEach((t, j) => {
      out.push(
        text(x, ins.length === 0 ? w - 8 : ax, ay + (j - (items.length - 1) / 2) * lh, [t], {
          fs: ifs,
          anchor: ins.length === 0 ? "end" : "middle",
        }),
      );
    });
  }
  return out.join("");
}

export function drawCarroll(s: Carroll, x: Ctx, w: number, h: number): string {
  const { c } = x;
  const fs = x.fs;
  const out: string[] = [];
  const headW = Math.min(
    w * 0.3,
    Math.max(...s.rows.map((r) => textWidth(r, x, fs, WEIGHT.value))) + 16,
  );
  const headH = fs * 2;
  const cw = (w - headW) / 2;
  const ch = (h - headH) / 2;
  const ifs = sub(fs, 0.9);
  s.cols.forEach((t, j) => {
    out.push(text(x, headW + cw * (j + 0.5), headH / 2, [t], { weight: WEIGHT.value }));
  });
  s.rows.forEach((t, i) => {
    out.push(
      text(x, headW / 2, headH + ch * (i + 0.5), wrap(t, x, headW - 10, 2, fs, WEIGHT.value), {
        weight: WEIGHT.value,
      }),
    );
  });
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      const items = s.cells[i]?.[j] ?? [];
      const x0 = headW + cw * j;
      const y0 = headH + ch * i;
      out.push(
        `<rect x="${n(x0)}" y="${n(y0)}" width="${n(cw)}" height="${n(ch)}" fill="${(i + j) % 2 ? c.surface : x.c.tint}" stroke="${c.ink}" stroke-width="${STROKE.line}"/>`,
      );
      const per = Math.max(1, Math.floor((ch - 8) / (ifs * 1.25)));
      if (items.length > per * 2) bad(x, "a Carroll cell holds too many items");
      const cols = items.length > per ? 2 : 1;
      items.forEach((t, k) => {
        const col = Math.floor(k / per);
        const rowsHere = Math.min(per, items.length - col * per);
        const row = k % per;
        out.push(
          text(
            x,
            x0 + (cw / cols) * (col + 0.5),
            y0 + ch / 2 + (row - (rowsHere - 1) / 2) * ifs * 1.25,
            [t],
            { fs: ifs },
          ),
        );
      });
    }
  return out.join("");
}
