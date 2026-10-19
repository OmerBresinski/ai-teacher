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
/**
 * The seam connector family (round 2 roles2.css `--connector`, round 5 roles-map5.js): a filled
 * block arrow (the default), Poster's block with an ink offset, Scrapbook's hand-drawn sketch line,
 * Storytime's round-cornered block. Each is drawn inside the box the layout measured for the arrow.
 */
export const CONNECTORS = ["block", "block-offset", "line", "sketch", "round"] as const;
export type Connector = (typeof CONNECTORS)[number];

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
  connector: Connector;
  /** The notch leg (Geometric's cut corners), in points; inside every role's `EDGE_BUDGET`. */
  notch: number;
  /** An offset block's distance and colour (Poster's 8pt ink block), or null. */
  offset: { d: number; color: string } | null;
  /** The sticky key's paper and tilt (Scrapbook), or null. */
  sticky: { fill: string; tilt: number } | null;
  /** Degrees a badge turns (Scrapbook's round 2 `--badge-tilt: -4deg`); 0 upright. */
  badgeTilt: number;
  /** The hinge key's face: the card's ink (default) or the theme's accent (Geometric's gold). */
  keyFill: "ink" | "accent";
  /** Tracking on the myth's MYTH / FACT tags (Geometric 0.08em), or null for the preset's own. */
  tagTracking: string | null;
  /** Tracking on the cover kicker (Geometric 0.10em), or null for the caption's own 0.08em. */
  kickerTracking: string | null;
  /** The emphasis colour inside a fact or field (Geometric's `--fa-accent` #1842B8), or null for the accent. */
  emphasis: string | null;
  /** Proof medals' icons drawn with an ink outline (Geometric's gold), else as they come. */
  iconOutline: boolean;
  /** The worked rail's colour ahead of the step (Geometric's gold #9AA8C0), or null for the rule. */
  railAhead: string | null;
  /**
   * The hinge's right-answer ring drawn inside the card at this width (Geometric: roles2.css
   * `inset 0 0 0 4px`, 2.67pt), or 0 for the default 3pt ring outside it.
   */
  rightRingInset: number;
  /**
   * The accent strip along the slide's foot, in points (round 3 themes3.css `.footbar`: 14px at
   * 1440 = 9.33pt, on every slide but the cover, for the product themes and the darks), or 0.
   */
  footBar: number;
  /** The myth's struck claim weight (Geometric's round 5 myth: 600), or null for the default 500. */
  claimWeight: number | null;
  /** The myth's verdict disc in px at 1440 (Geometric: 42), or 0 for the default. */
  verdictDisc: number;
  /** Whether the myth's seam badge sits in a halo (false: Geometric's seam sits on the panels). */
  seamHalo: boolean;
};

/** An offset block may sit at most this far from its surface (THEMING.md section 6: card ≤ 8). */
export const OFFSET_MAX = 8;
/** A notch leg is held under the card budget (10) so it never reaches content. */
export const NOTCH_MAX = 11;
/** A torn edge bites at most this far in (inside the field budget of 16). */
export const TORN_DEPTH = 5;
/** A sticky key tilts at most this much (THEMING.md section 6: tilt ≤ 3°). */
export const TILT_MAX = 3;
/** A badge tilts at most this much (Scrapbook's gold `--badge-tilt: -4deg`, its number still level enough to read). */
export const BADGE_TILT_MAX = 4;

const pick = <T extends string>(all: readonly T[], v: string | undefined, d: T): T =>
  v != null && (all as readonly string[]).includes(v) ? (v as T) : d;
const num = (v: string | undefined): number => Number.parseFloat(v ?? "0") || 0;
const clampAbs = (v: number, max: number) => Math.max(-max, Math.min(max, v));

/** An em tracking token ("0.08em"), or null when missing or malformed. */
const em = (v: string | undefined): string | null =>
  v && /^-?(0|0?\.\d{1,3})em$/.test(v) ? v : null;

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
    connector: pick(CONNECTORS, t["connector"], "block"),
    notch: Math.min(NOTCH_MAX, num(t["notch"])),
    offset: offset > 0 ? { d: offset, color: t["offset-color"] ?? t["ink"] ?? "#000000" } : null,
    sticky: sticky ? { fill: sticky, tilt: clampAbs(num(t["sticky-tilt"]), TILT_MAX) } : null,
    badgeTilt: clampAbs(num(t["badge-tilt"]), BADGE_TILT_MAX),
    keyFill: t["key-fill"] === "accent" ? "accent" : "ink",
    tagTracking: em(t["tag-tracking"]),
    kickerTracking: em(t["kicker-tracking"]),
    emphasis: /^#[0-9a-f]{6}$/i.test(t["emphasis"] ?? "") ? (t["emphasis"] as string) : null,
    iconOutline: t["icon-outline"] === "ink",
    railAhead: /^#[0-9a-f]{6}$/i.test(t["rail-ahead"] ?? "") ? (t["rail-ahead"] as string) : null,
    footBar: Math.max(0, num(t["foot-bar"])),
    rightRingInset: Math.min(4, Math.max(0, num(t["right-ring-inset"]))),
    claimWeight: num(t["claim-weight"]) >= 400 ? Math.min(800, num(t["claim-weight"])) : null,
    verdictDisc: Math.min(60, Math.max(0, num(t["verdict-disc"]))),
    seamHalo: t["seam-halo"] !== "none",
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
export function hexagonPoints(inset = 0.25, vInset = 0): Pt[] {
  return [
    { x: inset, y: vInset },
    { x: 1 - inset, y: vInset },
    { x: 1, y: 0.5 },
    { x: 1 - inset, y: 1 - vInset },
    { x: inset, y: 1 - vInset },
    { x: 0, y: 0.5 },
  ];
}

/**
 * A hexagon mark's top and bottom edges sit this far inside its square box (round 2 roles2.css,
 * badge/key/chip/medal `polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%)`), so a 48px
 * badge is 48 wide and 44 tall, not 48 square (Greg, 17 Oct: "the hexagons feel taller than the
 * gold"). The cover's picture hexagon fills its box (cover5 `.hex`).
 */
export const MARK_HEX_V = 0.04;

/** The outline of a hexagon mark (`ShapeKind` "hexagon": badges, keys, medals, the myth seam). */
export const markHexagonPoints = (): Pt[] => hexagonPoints(0.25, MARK_HEX_V);

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
/**
 * Which corners a notch cuts: `diag` top-left and bottom-right (the hinge key, round 2's
 * `polygon(22% 0, ..., 0 22%)`), `all` four (Geometric's fields and plate), `tr` the top-right only
 * (the cover kicker, cover5 `.kick`). Mirrored for RTL as box fractions (x to 1 - x).
 */
export type NotchCorners = "diag" | "all" | "tr";

export function notchPoints(
  w: number,
  h: number,
  leg: number,
  corners: NotchCorners = "diag",
): Pt[] {
  const n = Math.max(0, Math.min(leg, w / 2, h / 2));
  const tl = corners !== "tr";
  const tr = corners === "all" || corners === "tr";
  const br = corners !== "tr";
  const bl = corners === "all";
  const pts: Pt[] = [
    ...(tl ? [{ x: n, y: 0 }] : [{ x: 0, y: 0 }]),
    ...(tr
      ? [
          { x: w - n, y: 0 },
          { x: w, y: n },
        ]
      : [{ x: w, y: 0 }]),
    ...(br
      ? [
          { x: w, y: h - n },
          { x: w - n, y: h },
        ]
      : [{ x: w, y: h }]),
    ...(bl
      ? [
          { x: n, y: h },
          { x: 0, y: h - n },
        ]
      : [{ x: 0, y: h }]),
    ...(tl ? [{ x: 0, y: n }] : []),
  ];
  return frac(pts, w, h);
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

/** A connector drawn in its box: closed outlines (filled) and open strokes, in box points. */
export type ConnectorShape = {
  /** Filled outlines, each closed; `offset` shifts an ink copy under it (Poster's block). */
  fills: { pts: Pt[]; round?: number; offset?: number }[];
  /** Open strokes (the sketch's cubic shaft and its chevron head), as point lists. */
  strokes: Pt[][];
  /** The stroke width of `strokes` and of a round fill's rounding, in points. */
  width: number;
  /** The ground-coloured halo stroked under everything, in points. */
  halo: number;
};

/** A cubic from p0 to p3 as `n` points (the sketch shaft). */
function cubicPoints(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 24): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return {
      x: r4(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x),
      y: r4(u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y),
    };
  });
}

/**
 * The round 5 arrow head (roles-map5.js `arrowHead`): an open chevron whose tip is the shaft's end,
 * arms at +-32 degrees about the end tangent, each 3.2 x the stroke long.
 */
export function chevronHead(tip: Pt, dir: Pt, sw: number): Pt[] {
  const len = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / len;
  const uy = dir.y / len;
  const a = (32 * Math.PI) / 180;
  const arm = (s: number): Pt => {
    const c = Math.cos(s * a);
    const n = Math.sin(s * a);
    return {
      x: r4(tip.x - (ux * c - uy * n) * sw * 3.2),
      y: r4(tip.y - (ux * n + uy * c) * sw * 3.2),
    };
  };
  return [arm(1), { x: r4(tip.x), y: r4(tip.y) }, arm(-1)];
}

/**
 * A connector family's outline in a `w` x `h` box, in points (gold: roles-map2.js `arrowSvg`, its
 * sketch replaced by roles-map5.js's cubic + chevron with no ghost stroke). The stroke is the
 * gold's `max(5, round(h * .12))` px read in points at the 1440 scale (/1.5), so a 960-wide slide
 * draws what the 1440 gold drew.
 */
export function connectorShape(kind: Connector, w: number, h: number): ConnectorShape {
  const k = 1.5; // the gold's px per slide point
  const lw = Math.max(5, Math.round(h * k * 0.12)) / k;
  const P = (pts: [number, number][]): Pt[] =>
    pts.map(([x, y]) => ({ x: r4(x * w), y: r4(y * h) }));
  const block = P([
    [0.04, 0.3],
    [0.52, 0.3],
    [0.52, 0.04],
    [0.96, 0.5],
    [0.52, 0.96],
    [0.52, 0.7],
    [0.04, 0.7],
  ]);
  switch (kind) {
    case "block-offset":
      return { fills: [{ pts: block, offset: 5 / k }], strokes: [], width: 3 / k, halo: 7 / k };
    case "round":
      return {
        fills: [
          {
            pts: P([
              [0.1, 0.34],
              [0.5, 0.34],
              [0.5, 0.12],
              [0.9, 0.5],
              [0.5, 0.88],
              [0.5, 0.66],
              [0.1, 0.66],
            ]),
            round: lw,
          },
        ],
        strokes: [],
        width: lw,
        halo: lw + 12 / k,
      };
    case "sketch":
    case "line": {
      const sw = kind === "line" ? Math.max(4, Math.round(lw * k * 0.7)) / k : lw;
      const p0 = kind === "line" ? { x: w * 0.06, y: h * 0.5 } : { x: w * 0.05, y: h * 0.6 };
      const c1 = kind === "line" ? { x: w * 0.35, y: h * 0.5 } : { x: w * 0.3, y: h * 0.34 };
      const c2 = kind === "line" ? { x: w * 0.6, y: h * 0.5 } : { x: w * 0.56, y: h * 0.66 };
      const p1 = { x: w * 0.9, y: h * 0.5 };
      const shaft = cubicPoints(p0, c1, c2, p1);
      const head = chevronHead(p1, { x: p1.x - c2.x, y: p1.y - c2.y }, sw);
      return { fills: [], strokes: [shaft, head], width: sw, halo: sw + 10 / k };
    }
    default:
      return { fills: [{ pts: block }], strokes: [], width: 0, halo: 7 / k };
  }
}
