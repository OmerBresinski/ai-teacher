/**
 * BAKEOFF polish arm (rootcause/uk-seasons.md faults 2 and 4). Everything here is behind one
 * process-wide switch, off by default, so every other arm draws byte for byte as before:
 *  - flow and cycle nodes sized to their words, filled with a wash that reads against the ground,
 *    the panel and the accent wash on every theme (no outline needed under the flat finish);
 *  - a label-gap gate: two labels that touch or overlap at all are a readability fault, so
 *    drawDiagram refits (a smaller size, a simpler form) and then drops the drawing;
 *  - the `strips` kind (day length): rows of N equal units, light units yellow with a sun, dark
 *    units navy with a moon, the row's name at the left and its light count at the right.
 * The `strips` kind is not in DiagramSpecSchema: adding it there would change the director's and
 * drawer's kind lists for every arm. parseDiagram reads it only while the switch is on.
 */
import { z } from "zod";
import { calloutTones } from "../themes";
import { WEIGHT } from "./style";
import type { Ctx, DrawnText, Palette } from "./svg";
import { mix, n, text, textWidth } from "./svg";

/** WCAG contrast of two #rrggbb colours (look.ts's formula; not imported, to keep this module a leaf). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const v = Number.parseInt(hex.replace("#", ""), 16);
    const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
      const t = c / 255;
      return t <= 0.03928 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

let on = false;
/** Turn the polish arm's drawing on or off (run.ts sets it once for `--arm polish`). */
export function setDiagramPolish(v: boolean): void {
  on = v;
}
export const diagramPolish = (): boolean => on;
/** Run `f` with the switch at `v`, then restore it (synchronous; tests and the before/after renders). */
export function withDiagramPolish<T>(v: boolean, f: () => T): T {
  const was = on;
  on = v;
  try {
    return f();
  } finally {
    on = was;
  }
}

// ─── node fill ────────────────────────────────────────────────────────────────────────────────

/** The least contrast a filled node keeps against the ground, the panel and the accent wash. */
export const NODE_EDGE_CONTRAST = 1.3;
/** Ink on a node fill: AA body text. */
export const NODE_TEXT_CONTRAST = 4.5;

/**
 * A node's fill: the accent (light themes) or the ink (dark themes) washed into the panel, the
 * lightest share that stands off the ground, the panel and the tint while the ink still reads on it.
 */
export function nodeFill(c: Palette, dark: boolean): string {
  const base = dark ? c.ink : c.accent;
  for (let s = 0.2; s <= 0.62; s += 0.02) {
    const f = mix(base, c.surface, s);
    const edge = Math.min(...[c.bg, c.surface, c.tint].map((g) => contrastRatio(f, g)));
    if (edge >= NODE_EDGE_CONTRAST && contrastRatio(c.ink, f) >= NODE_TEXT_CONTRAST) return f;
  }
  return mix(base, c.surface, 0.3);
}

/** A box narrowed to its words: the widest line plus padding, never wider than it was. */
export function snug<B extends { w: number }>(b: B, lineW: number, fs: number): B {
  return { ...b, w: Math.min(b.w, Math.max(lineW + fs * 1.6, fs * 3)) };
}

// ─── label gap gate ───────────────────────────────────────────────────────────────────────────

/** The clear room two labels on one line keep between them, as a share of the larger size. */
export const LABEL_GAP_EM = 0.3;

/**
 * Labels that touch or overlap (any amount): on one line (their bands share most of the smaller
 * height) closer than LABEL_GAP_EM, or overlapping at all otherwise. "daylight" @[45,31] and
 * "dark" @[68,31] fused into "daylightdark" (uk-seasons fault 4) under the 15% overlap rule.
 */
export function labelGapFaults(rec: DrawnText[], fallbackFs = 18): string[] {
  const out: string[] = [];
  for (let i = 0; i < rec.length; i++)
    for (let j = i + 1; j < rec.length; j++) {
      const a = rec[i] as DrawnText;
      const b = rec[j] as DrawnText;
      const vy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const minH = Math.min(a.y1 - a.y0, b.y1 - b.y0);
      if (vy <= 0 || minH <= 0) continue;
      const gapX = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
      const fs = Math.max(a.fs ?? fallbackFs, b.fs ?? fallbackFs);
      const sameLine = vy >= 0.5 * minH;
      if ((sameLine && gapX < LABEL_GAP_EM * fs) || gapX < 0)
        out.push(`the labels "${a.text}" and "${b.text}" touch`);
    }
  return out;
}

// ─── strips (day length) ─────────────────────────────────────────────────────────────────────

/** Schema caps: what a slide can show and a Year 1 class can count. */
export const STRIPS_LIMITS = {
  rows: { min: 2, max: 4 },
  units: { min: 4, max: 24 },
  labelChars: 14,
  unitChars: 10,
  keyChars: 12,
} as const;

const short = (k: number) => z.string().trim().min(1).max(k);
export const StripsSchema = z
  .object({
    kind: z.literal("strips"),
    alt: z.string().trim().min(1).max(300),
    title: short(60).optional(),
    /** How many equal units every row has (24 hours). */
    units: z.number().int().min(STRIPS_LIMITS.units.min).max(STRIPS_LIMITS.units.max),
    /** The unit's name, plural, for the count at the right ("hours"). */
    unit: short(STRIPS_LIMITS.unitChars),
    /** The key's words for a light and a dark unit (default "day" and "night"). */
    key: z
      .object({ light: short(STRIPS_LIMITS.keyChars), dark: short(STRIPS_LIMITS.keyChars) })
      .optional(),
    rows: z
      .array(
        z.object({
          label: short(STRIPS_LIMITS.labelChars),
          /** How many units are light (daytime). */
          light: z.number().int().min(0),
          /** The first light unit (0-based); centred in the row when absent. */
          start: z.number().int().min(0).optional(),
        }),
      )
      .min(STRIPS_LIMITS.rows.min)
      .max(STRIPS_LIMITS.rows.max),
  })
  .superRefine((s, ctx) => {
    s.rows.forEach((r, i) => {
      if (r.light > s.units)
        ctx.addIssue({ code: "custom", path: ["rows", i, "light"], message: "more than units" });
      if (r.start !== undefined && r.start + r.light > s.units)
        ctx.addIssue({ code: "custom", path: ["rows", i, "start"], message: "runs past the row" });
    });
  });
export type Strips = z.infer<typeof StripsSchema>;

/** The strips' colours from the kit: the key-words callout tone (amber) for day, ink for night. */
export function stripColours(c: Palette, dark: boolean, themeId?: string) {
  const tone = calloutTones({ id: themeId ?? "", dark } as never)["key-words"];
  if (dark)
    return { day: tone.icon, sun: tone.fill, night: mix(c.ink, c.surface, 0.3), moon: tone.ink };
  return { day: tone.line, sun: tone.icon, night: mix(c.ink, c.surface, 0.9), moon: tone.fill };
}

const sunMark = (cx: number, cy: number, r: number, fill: string) => {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return `<line x1="${n(cx + c * r * 1.45)}" y1="${n(cy + s * r * 1.45)}" x2="${n(cx + c * r * 2)}" y2="${n(cy + s * r * 2)}" stroke="${fill}" stroke-width="${n(Math.max(1, r * 0.35))}"/>`;
  }).join("");
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"/>${rays}`;
};
const moonMark = (cx: number, cy: number, r: number, fill: string) =>
  // A crescent: the outer circle's left arc, back along a smaller offset arc.
  `<path d="M${n(cx + r * 0.3)},${n(cy - r * 0.95)} A${n(r)},${n(r)} 0 1 0 ${n(cx + r * 0.3)},${n(cy + r * 0.95)} A${n(r * 0.78)},${n(r * 0.78)} 0 0 1 ${n(cx + r * 0.3)},${n(cy - r * 0.95)} Z" fill="${fill}"/>`;

/** The first light unit of a row: its own start, or centred. */
export const lightStart = (units: number, r: { light: number; start?: number }) =>
  r.start ?? Math.floor((units - r.light) / 2);

export function drawStrips(s: Strips, x: Ctx & { themeId?: string }, w: number, h: number): string {
  const fs = x.fs;
  const col = stripColours(x.c, !!x.dark, x.themeId);
  const pad = fs * 0.6;
  // Slack on the measured words, so a fallback font never pushes them off the drawing.
  const slack = 1.2;
  const labelW = slack * Math.max(...s.rows.map((r) => textWidth(r.label, x, fs, WEIGHT.name)));
  const counts = s.rows.map((r) => `${r.light} ${s.unit}`);
  const countW = slack * Math.max(...counts.map((t) => textWidth(t, x, fs, 700)));
  const stripW = w - labelW - countW - pad * 2;
  const gap = Math.max(1, Math.min(4, (stripW / s.units) * 0.1));
  const u = (stripW - gap * (s.units - 1)) / s.units;
  if (u < 10) {
    x.faults?.push(`the strips' ${s.units} units are too narrow for the space`);
    return "";
  }
  const key = s.key ?? { light: "day", dark: "night" };
  const keyH = fs * 1.8;
  const rowGap = fs * 0.7;
  const rh = Math.min(
    Math.max(u * 2.2, fs * 1.8),
    fs * 3,
    (h - keyH - rowGap * s.rows.length) / s.rows.length,
  );
  if (rh < fs * 1.1) {
    x.faults?.push("the strips' rows do not fit the space");
    return "";
  }
  const totalH = s.rows.length * rh + (s.rows.length - 1) * rowGap + rowGap + keyH;
  const oy = (h - totalH) / 2;
  const x0 = labelW + pad;
  const mr = Math.min(u, rh) * 0.3;
  const out: string[] = [];
  s.rows.forEach((r, i) => {
    const y = oy + i * (rh + rowGap);
    out.push(text(x, labelW, y + rh / 2, [r.label], { anchor: "end", weight: WEIGHT.name, fs }));
    const st = lightStart(s.units, r);
    for (let k = 0; k < s.units; k++) {
      const light = k >= st && k < st + r.light;
      const ux = x0 + k * (u + gap);
      out.push(
        `<rect x="${n(ux)}" y="${n(y)}" width="${n(u)}" height="${n(rh)}" rx="${n(Math.min(4, u / 5))}" fill="${light ? col.day : col.night}"/>`,
      );
      if (mr >= 2.5)
        out.push(
          light
            ? sunMark(ux + u / 2, y + rh / 2, mr * 0.8, col.sun)
            : moonMark(ux + u / 2, y + rh / 2, mr * 1.3, col.moon),
        );
    }
    out.push(
      text(x, x0 + stripW + pad, y + rh / 2, [counts[i] as string], {
        anchor: "start",
        weight: WEIGHT.value,
        fs,
      }),
    );
  });
  // The key under the strips: one sun unit, one moon unit, each with its word.
  const ky = oy + s.rows.length * (rh + rowGap) + rowGap * 0.2;
  const ks = Math.min(keyH * 0.8, fs * 1.4);
  const lw = textWidth(key.light, x, fs, WEIGHT.label);
  const dw = textWidth(key.dark, x, fs, WEIGHT.label);
  const keyW = ks * 2 + lw + dw + fs * 2.2;
  let kx = x0 + (stripW - keyW) / 2;
  out.push(
    `<rect x="${n(kx)}" y="${n(ky)}" width="${n(ks)}" height="${n(ks)}" rx="3" fill="${col.day}"/>`,
    sunMark(kx + ks / 2, ky + ks / 2, ks * 0.19, col.sun),
    text(x, kx + ks + fs * 0.4, ky + ks / 2, [key.light], { anchor: "start", fs }),
  );
  kx += ks + fs * 0.4 + lw + fs * 1.4;
  out.push(
    `<rect x="${n(kx)}" y="${n(ky)}" width="${n(ks)}" height="${n(ks)}" rx="3" fill="${col.night}"/>`,
    moonMark(kx + ks / 2, ky + ks / 2, ks * 0.3, col.moon),
    text(x, kx + ks + fs * 0.4, ky + ks / 2, [key.dark], { anchor: "start", fs }),
  );
  return out.join("");
}
