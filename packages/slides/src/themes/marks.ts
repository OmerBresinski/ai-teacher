/*
 * Theme marks (TEACH-215 part c, THEMING.md section 6 "shape families" as trimmed in rounds 4
 * and 5). A family is a keyword token (`badge-shape: hex`); the surface painter reads it as an enum
 * and draws a real shape. Every shape here is drawn inside the box the layout measured, so no
 * keyword moves a box, a padding or a type size (THEMING.md invariant): a notch, a torn edge or
 * an offset block is paint inside the role's budget.
 *
 * The geometry is pure: points in box fractions (0..1), the form a closed `path` element and the
 * PPTX `custGeom` both take, so the editor and the export draw the same outline.
 */

/** The small-shape families: badges, keys, medals and chips (THEMING.md section 6 table). */
export const MARK_SHAPES = [
  "disc",
  "square",
  "rounded",
  "hex",
  "notch",
  "outline",
  "sticky",
  "tile",
  "pill",
  "tag",
] as const;
export type MarkShape = (typeof MARK_SHAPES)[number];

export const CARD_TREATS = ["plain", "offset", "outline"] as const;
export type CardTreat = (typeof CARD_TREATS)[number];
export const RULE_STYLES = ["solid", "dashed", "dots"] as const;
export type RuleStyle = (typeof RULE_STYLES)[number];
export const FRAME_STYLES = ["plain", "offset", "polaroid", "notch"] as const;
export type FrameStyle = (typeof FRAME_STYLES)[number];
export const FIELD_EDGES = ["straight", "torn", "notch"] as const;
export type FieldEdge = (typeof FIELD_EDGES)[number];
export const TITLE_TREATS = ["none", "band"] as const;
export type TitleTreat = (typeof TITLE_TREATS)[number];
/** The cover family (THEMING.md section 6, round 5 `cover5.html`): one per theme. */
export const COVER_COMPS = [
  "type",
  "split",
  "bleed",
  "collage",
  "shape",
  "masthead",
  "framed",
] as const;
export type CoverComp = (typeof COVER_COMPS)[number];
export const GROUND_ARTS = ["none", "lined", "dots"] as const;
export type GroundArt = (typeof GROUND_ARTS)[number];

/** A theme's mark keywords, read from its tokens with the plain defaults. */
export type ThemeMarks = {
  badge: MarkShape;
  key: MarkShape;
  medal: MarkShape;
  chip: MarkShape;
  card: CardTreat;
  rule: RuleStyle;
  frame: FrameStyle;
  field: FieldEdge;
  title: TitleTreat;
  cover: CoverComp;
  ground: GroundArt;
  /** The notch leg (Geometric's cut corners), in points; inside every role's `EDGE_BUDGET`. */
  notch: number;
  /** An offset block's distance and colour (Poster's 8pt ink block), or null. */
  offset: { d: number; color: string } | null;
  /** The sticky key's paper and tilt (Scrapbook), or null. */
  sticky: { fill: string; tilt: number } | null;
  /** The accent bar at the slide's foot (the dark themes, 14px at 1440 = 9pt), or 0. */
  footBar: number;
};

/** An offset block may sit at most this far from its surface (THEMING.md section 6: card ≤ 8). */
export const OFFSET_MAX = 8;
/** A notch leg is held under the card budget (10) so it never reaches content. */
export const NOTCH_MAX = 10;
/** A torn edge bites at most this far in (inside the field budget of 16). */
export const TORN_DEPTH = 5;
/** A sticky key tilts at most this much (THEMING.md section 6: tilt ≤ 3°). */
export const TILT_MAX = 3;

const pick = <T extends string>(all: readonly T[], v: string | undefined, d: T): T =>
  v != null && (all as readonly string[]).includes(v) ? (v as T) : d;
const num = (v: string | undefined): number => Number.parseFloat(v ?? "0") || 0;
const clampAbs = (v: number, max: number) => Math.max(-max, Math.min(max, v));

/** The keyword tokens a theme sets, typed; an unknown or missing keyword takes the plain default. */
export function marksFromTokens(t: Readonly<Record<string, string>>): ThemeMarks {
  const offset = Math.min(OFFSET_MAX, Math.abs(num(t["offset"])));
  const sticky = t["sticky-fill"];
  return {
    badge: pick(MARK_SHAPES, t["badge-shape"], "disc"),
    key: pick(MARK_SHAPES, t["key-shape"], "rounded"),
    medal: pick(MARK_SHAPES, t["medal-shape"], "disc"),
    chip: pick(MARK_SHAPES, t["chip-shape"], "pill"),
    card: pick(CARD_TREATS, t["card-treat"], "plain"),
    rule: pick(RULE_STYLES, t["rule-style"], "solid"),
    frame: pick(FRAME_STYLES, t["frame-style"], "plain"),
    field: pick(FIELD_EDGES, t["field-edge"], "straight"),
    title: pick(TITLE_TREATS, t["title-treat"], "none"),
    cover: pick(COVER_COMPS, t["cover"], "type"),
    ground: pick(GROUND_ARTS, t["ground-art"], "none"),
    notch: Math.min(NOTCH_MAX, num(t["notch"])),
    offset: offset > 0 ? { d: offset, color: t["offset-color"] ?? t["ink"] ?? "#000000" } : null,
    sticky: sticky ? { fill: sticky, tilt: clampAbs(num(t["sticky-tilt"]), TILT_MAX) } : null,
    footBar: Math.max(0, num(t["foot-bar"])),
  };
}

export type Pt = { x: number; y: number };
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const frac = (pts: Pt[], w: number, h: number): Pt[] =>
  pts.map((p) => ({ x: r4(p.x / w), y: r4(p.y / h) }));

/**
 * A flat-topped hexagon filling the box, in box fractions: the sides cut in by `inset` of the
 * width (cover5's `polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)` at 0.25).
 */
export function hexagonPoints(inset = 0.25): Pt[] {
  return [
    { x: inset, y: 0 },
    { x: 1 - inset, y: 0 },
    { x: 1, y: 0.5 },
    { x: 1 - inset, y: 1 },
    { x: inset, y: 1 },
    { x: 0, y: 0.5 },
  ];
}

/** The hexagon inset that keeps a small mark's sides at 60° whatever its aspect (w ≥ h·0.58). */
export const hexInset = (w: number, h: number): number =>
  Math.min(0.3, Math.max(0.1, h / 2 / Math.tan(Math.PI / 3) / w));

/** A regular-looking octagon in the box: each corner cut by `cut` of the short side. */
export function octagonPoints(w: number, h: number, cut = 0.29): Pt[] {
  const c = Math.min(w, h) * cut;
  return frac(
    [
      { x: c, y: 0 },
      { x: w - c, y: 0 },
      { x: w, y: c },
      { x: w, y: h - c },
      { x: w - c, y: h },
      { x: c, y: h },
      { x: 0, y: h - c },
      { x: 0, y: c },
    ],
    w,
    h,
  );
}

/**
 * A rectangle with its top-left and bottom-right corners cut by `leg` points (Geometric's
 * `--frame-clip`, PPTX `snip2DiagRect`), in box fractions.
 */
export function notchPoints(w: number, h: number, leg: number): Pt[] {
  const n = Math.max(0, Math.min(leg, w / 2, h / 2));
  return frac(
    [
      { x: n, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h - n },
      { x: w - n, y: h },
      { x: 0, y: h },
      { x: 0, y: n },
    ],
    w,
    h,
  );
}

/** Which sides of a box are torn; a side flush with the slide edge stays straight (rule 3). */
export type Sides = { top: boolean; right: boolean; bottom: boolean; left: boolean };

/** A small deterministic generator: the same box always tears the same way (stable renders). */
function seeded(seed: number): () => number {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => {
    s = (s * 48271) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * A torn-paper outline: each torn side zig-zags inward by up to `depth` points every 6–10
 * points; the corners stay on the box, so the shape never leaves the layout's box and never
 * bites deeper than `depth` (inside the field's budget). In box fractions, clockwise from TL.
 */
export function tornPoints(
  w: number,
  h: number,
  sides: Sides,
  depth = TORN_DEPTH,
  seed = w * 31 + h * 17,
): Pt[] {
  const rand = seeded(seed);
  const d = Math.max(0, Math.min(depth, w / 4, h / 4));
  const pts: Pt[] = [];
  const edge = (len: number, torn: boolean, at: (t: number, inward: number) => Pt): void => {
    pts.push(at(0, 0));
    if (!torn) return;
    let t = 4 + rand() * 4;
    while (t < len - 4) {
      pts.push(at(t, d * (0.25 + rand() * 0.75)));
      t += 6 + rand() * 4;
    }
  };
  edge(w, sides.top, (t, i) => ({ x: t, y: i }));
  edge(h, sides.right, (t, i) => ({ x: w - i, y: t }));
  edge(w, sides.bottom, (t, i) => ({ x: w - t, y: h - i }));
  edge(h, sides.left, (t, i) => ({ x: i, y: h - t }));
  return frac(pts, w, h);
}

/** The sides of a box inside the slide (a side within 1pt of the slide's edge is a bleed). */
export function innerSides(
  box: { x: number; y: number; w: number; h: number },
  slide = { w: 960, h: 540 },
): Sides {
  return {
    top: box.y > 1,
    left: box.x > 1,
    right: box.x + box.w < slide.w - 1,
    bottom: box.y + box.h < slide.h - 1,
  };
}

/** Twice the signed area of a closed outline in box fractions (positive = clockwise on screen). */
export function outlineArea(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const q = pts[(i + 1) % pts.length] as Pt;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
