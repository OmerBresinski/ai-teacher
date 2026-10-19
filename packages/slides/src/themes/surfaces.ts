import type { PathElement, ShapeElement, Theme } from "@tj/domain/documents";
import { contrastRatio, mix } from "../colour-contrast";
import { ALL_THEMES } from "../themes";

/** Unlabelled surfaces: a cut corner is drawn as a closed path in box fractions (RTL mirrors it). */
const FIELD_LIKE: ReadonlySet<string> = new Set(["field-a", "field-b", "card", "plate", "frame"]);

import {
  innerSides,
  type MarkShape,
  marksFromTokens,
  notchPoints,
  type ThemeMarks,
  tornPoints,
} from "./marks";
import TOKENS from "./tokens.json" with { type: "json" };

/*
 * Surface roles (TEACH-215 part b; UX rulings 107, 159, 211, 212, 213, 235, 236). A layout never
 * names a colour for a painted part: it names the part's role (a field, a card, a badge ...) and
 * the theme answers with a `SurfaceStyle`. The values come from `tokens.json`, which is the final
 * token file for the sixteen themes as the theming pass wrote it (theme -> kebab token -> value),
 * so a new token set drops in as a file. `paintSurface` draws one role as one element under its
 * content; the PPTX export keeps it because the element is a native shape or a closed path.
 */

/** The painted roles a layout tags (THEME-FIT "Final role list"; the categorical sets are part c). */
export const SURFACE_ROLES = [
  "title",
  "kicker",
  "field-a",
  "field-b",
  "card",
  "plate",
  "badge",
  "marker",
  "medal",
  "chip",
  "frame",
  "rule",
  "key",
  "connector",
  "verdict-right",
  "verdict-wrong",
  "track",
  "scrim",
] as const;
export type SurfaceRole = (typeof SURFACE_ROLES)[number];

/** Where a title sits. Only `top` and `top-box` may wear a band; `hero` and `inline` never do. */
export const TITLE_ZONES = ["top", "top-box", "hero", "inline"] as const;
export type TitleZone = (typeof TITLE_ZONES)[number];
export const BANDED_ZONES: ReadonlySet<TitleZone> = new Set(["top", "top-box"]);

/** A role's state: the now step, a quiet label, a right answer, a flat card ... */
export type SurfaceState = "now" | "inverse" | "ghost" | "quiet" | "flat" | "right" | "tint";

/**
 * How one role paints. `corner` is a radius in points, `"own"` (keep the layout's per-side
 * corners), or `"full"` (a pill or a disc). `edge` is a notch or fold size and `shadow` an offset
 * block, both inside the role's budget (`EDGE_BUDGET`, `SHADOW_MAX`).
 */
export type SurfaceStyle = {
  fill: string;
  pattern?: string;
  line?: string;
  lineWidth?: number;
  corner: number | "own" | "full";
  edge?: number;
  shadow?: { x: number; y: number; color: string };
  ink?: string;
  /**
   * The drawn outline when it is not a rectangle, disc or pill (THEMING.md section 6 families):
   * a hexagon, an octagon, two cut corners (`edge` is the leg) or a torn edge (`edge` is the
   * depth; only the sides inside the slide tear). Every one stays inside the measured box.
   */
  shape?: "hexagon" | "octagon" | "notch" | "torn";
  /** A rule drawn as dashes or dots instead of a solid bar. */
  dash?: "dashed" | "dotted";
  /** Degrees; a sticky key's tilt (≤ 3°). */
  tilt?: number;
};

/** The roles whose notch cuts all four corners (Geometric's fields and plate). */
const ALL_CUT = new Set<SurfaceRole>(["field-a", "field-b", "plate"]);

/** A notch or fold may not reach the content: field 16, card 10, plate 6 (THEME-FIT checks). */
export const EDGE_BUDGET: Partial<Record<SurfaceRole, number>> = {
  "field-a": 16,
  "field-b": 16,
  card: 10,
  plate: 6,
  // A small mark's cut corner (Geometric's notched key): inside its own box, clear of its glyph.
  key: 8,
  badge: 8,
  chip: 8,
};
/** An offset (shadow) block sits at most this far from its surface. */
export const SHADOW_MAX = 8;

/** A theme's surfaces: one style per role and state, the title zones and the single-tone tokens. */
export type ThemeSurfaces = {
  mode: "light" | "dark";
  ground: string;
  /** The theme's corner for rounded surfaces; undefined keeps each layout's own. */
  corner?: number;
  titleMuted: string;
  nowInk: string;
  badgeNow: string;
  track: { fill: string; ink: string };
  medalTint: string;
  chipQuiet: { fill: string; ink: string };
  cardFlat: { line: string; width: number };
  /** Locked: the same in every theme (the "AI picture" label on a photo). */
  scrim: { fill: string; ink: string };
  /** The four colour slots, rose, blue, amber, teal (ruling 248; `slots.ts` makes them). */
  slots: { fill: string; ink: string }[];
  /** The faintest text that still reads (ruling 248): never fade text, use this. */
  dim: string;
  roles: Record<SurfaceRole, SurfaceStyle>;
  states: Partial<Record<`${SurfaceRole}:${SurfaceState}`, SurfaceStyle>>;
  /** A zone's band, or null when the zone is never banded or the theme has no band. */
  zones: Record<TitleZone, SurfaceStyle | null>;
  /** The theme's mark keywords (badge shape, card treatment, cover ...). */
  marks: ThemeMarks;
};

export type SurfaceTokens = Record<string, string>;
const px = (v: string | undefined): number => Number.parseFloat(v ?? "0") || 0;

/** True when a colour paints nothing: `transparent` or an `#RRGGBB00`. */
export const isClear = (c: string | undefined): boolean =>
  !c || c === "transparent" || /^#[0-9a-f]{6}00$/i.test(c);

/** A small mark's look: its shape family as corner, outline, fill and tilt (THEMING.md section 6). */
export function markStyle(
  base: SurfaceStyle,
  shape: MarkShape,
  marks: ThemeMarks,
  _ground: string,
): SurfaceStyle {
  const { shape: _s, tilt: _t, shadow: _o, ...plain } = base;
  switch (shape) {
    case "disc":
    case "pill":
      return { ...plain, corner: "full" };
    case "square":
      return { ...plain, corner: 0 };
    case "tile":
      return {
        ...plain,
        corner: 0,
        ...(marks.offset
          ? {
              // round 2 themes2.css `--medal-shade: 6px 6px 0` and `--medal-lw: 3px`, at 1440 / 1.5.
              shadow: { x: 4, y: 4, color: marks.offset.color },
              line: marks.offset.color,
              lineWidth: 2,
            }
          : {}),
      };
    case "rounded":
    case "tag":
      return { ...plain, corner: 6 };
    case "hex":
      return { ...plain, corner: 0, shape: "hexagon" };
    case "notch":
      return {
        ...plain,
        corner: 0,
        shape: "notch",
        edge: Math.max(4, Math.min(marks.notch || 8, 8)),
      };
    case "outline":
      // A ring in the mark's own colour on the ground, its glyph in that colour.
      return {
        ...plain,
        fill: "transparent",
        line: isClear(base.fill) ? base.line : base.fill,
        lineWidth: 2.5,
        ink: isClear(base.fill) ? base.ink : base.fill,
        corner: plain.corner === "full" ? "full" : 6,
      };
    case "sticky":
      return marks.sticky
        ? { ...plain, fill: marks.sticky.fill, corner: 2, tilt: marks.sticky.tilt }
        : plain;
  }
}

/** Lays a theme's mark keywords over its role styles, in place. */
function withMarks(
  roles: Record<SurfaceRole, SurfaceStyle>,
  states: ThemeSurfaces["states"],
  marks: ThemeMarks,
  ground: string,
): void {
  // A family at its plain default (disc, pill, rounded key) keeps the role exactly as it was.
  if (marks.badge !== "disc") roles.badge = markStyle(roles.badge, marks.badge, marks, ground);
  if (marks.medal !== "disc") roles.medal = markStyle(roles.medal, marks.medal, marks, ground);
  if (marks.chip !== "pill") roles.chip = markStyle(roles.chip, marks.chip, marks, ground);
  if (marks.key !== "rounded") roles.key = markStyle(roles.key, marks.key, marks, ground);
  // A state keeps its family's outline but is filled: the now badge is the solid one.
  const solid = (st: SurfaceStyle | undefined, shape: MarkShape): SurfaceStyle | undefined => {
    if (!st) return st;
    const m = markStyle(
      st,
      shape === "outline" ? (marks.badge === "outline" ? "disc" : "rounded") : shape,
      marks,
      ground,
    );
    return m;
  };
  if (marks.badge !== "disc")
    for (const k of ["badge:now", "badge:inverse", "badge:ghost"] as const)
      states[k] = solid(states[k], marks.badge);
  if (marks.chip !== "pill")
    for (const k of ["chip:now", "chip:quiet"] as const) states[k] = solid(states[k], marks.chip);
  if (marks.key !== "rounded") {
    const right = states["key:right"];
    const shaped = solid(right, marks.key);
    // A sticky key's right state keeps the correct green with a white letter (scrapbook gold's
    // revealed key), not the sticky paper and its dark ink: only shape and tilt are the family's.
    const white = (f: string | undefined) =>
      f && contrastRatio("#FFFFFF", f) >= contrastRatio(right?.ink ?? "#000000", f);
    states["key:right"] =
      marks.key === "sticky" && right && shaped
        ? { ...shaped, fill: right.fill, ink: white(right.fill) ? "#FFFFFF" : right.ink }
        : shaped;
  }
  if (marks.medal !== "disc") states["medal:tint"] = solid(states["medal:tint"], marks.medal);
  const offset = marks.offset
    ? { x: marks.offset.d, y: marks.offset.d, color: marks.offset.color }
    : undefined;
  if (marks.card === "offset" && offset) {
    roles.card = { ...roles.card, shadow: offset };
    roles.plate = { ...roles.plate, shadow: offset, lineWidth: 3 };
    for (const k of ["card:flat", "card:right"] as const) {
      const st = states[k];
      if (st) states[k] = { ...st, shadow: offset };
    }
  }
  if (marks.frame === "offset" && offset) roles.frame = { ...roles.frame, shadow: offset };
  if (marks.field === "torn") {
    for (const r of ["field-a", "field-b"] as const)
      roles[r] = { ...roles[r], shape: "torn", edge: 5, corner: 0 };
  }
  if (marks.field === "notch" && marks.notch > 0) {
    // Round 2/5 Geometric: fields cut all four corners (`--fb-notch: 16px`), the plate 6px
    // (`--plate-notch`, 4pt); cards stay square outlines (`--card-radius: 0`).
    const n = { shape: "notch" as const, edge: marks.notch, corner: 0 };
    for (const r of ["field-a", "field-b"] as const)
      roles[r] = { ...roles[r], ...n, edge: Math.min(n.edge, EDGE_BUDGET[r] ?? n.edge) };
    roles.plate = { ...roles.plate, ...n, edge: Math.min(4, EDGE_BUDGET.plate ?? 4) };
  }
  if (marks.rule === "dashed") roles.rule = { ...roles.rule, dash: "dashed" };
  if (marks.rule === "dots") roles.rule = { ...roles.rule, dash: "dotted" };
}

/** The kebab token record a theme file holds, as typed surfaces. */
export function surfacesFromTokens(t: SurfaceTokens): ThemeSurfaces {
  const need = (k: string): string => {
    const v = t[k];
    if (v == null) throw new Error(`surface token "${k}" is missing`);
    return v;
  };
  const corner = need("corner") === "own" ? undefined : px(need("corner"));
  const field = corner ?? "own";
  const lineOf = (c: string) => (isClear(c) ? undefined : c);
  const s = (
    fill: string,
    rest: Omit<SurfaceStyle, "fill" | "corner"> & { corner?: SurfaceStyle["corner"] } = {},
  ): SurfaceStyle => ({
    fill,
    corner: 0,
    ...rest,
  });
  const marks = marksFromTokens(t);
  const band = isClear(need("title-band"))
    ? null
    : s(need("title-band"), { ink: need("title-ink") });
  const cardLine = lineOf(need("card-line"));
  const flatLine = lineOf(need("card-flat-line"));
  const roles: Record<SurfaceRole, SurfaceStyle> = {
    title: s(need("title-band"), { ink: need("title-ink") }),
    kicker: s("transparent", { ink: need("title-muted") }),
    "field-a": s(need("fa-fill"), { ink: need("fa-ink"), corner: field }),
    // The field grain (THEMING.md look table: Scrapbook's kraft fields "with a grain pattern"):
    // the grain's dot colour, kept as the slot `pattern` (themes.css: rgb(120 90 40 / .07) dots on
    // the kraft, flattened to one hex so the 1.3:1 quiet rule can read it). The renderer draws the
    // dots; one that cannot leaves the plain fill (THEMING.md: "field grain ... dropped in PPTX").
    "field-b": s(need("fb-fill"), {
      ink: need("fb-ink"),
      corner: field,
      ...(t["fb-pattern"] ? { pattern: t["fb-pattern"] } : {}),
    }),
    card: s(need("card-fill"), {
      ink: need("card-ink"),
      line: cardLine,
      lineWidth: cardLine ? px(need("card-lw")) : undefined,
      corner: field,
    }),
    plate: s(need("plate-fill"), {
      ink: need("ink"),
      line: need("plate-line"),
      lineWidth: 2,
      corner: field,
    }),
    badge: s(need("badge-fill"), { ink: need("badge-ink"), corner: "full" }),
    marker: s(need("marker-fill"), { ink: need("marker-ink"), corner: "full" }),
    medal: s(need("medal-fill"), {
      line: lineOf(need("medal-line")),
      lineWidth: lineOf(need("medal-line")) ? 2 : undefined,
      corner: "full",
    }),
    chip: s(need("chip-fill"), { ink: need("chip-ink"), corner: "full" }),
    frame: s(need("surface"), { corner: corner ?? px(need("radius-pic")) }),
    rule: s(need("rule")),
    key: s(need("accent"), { ink: need("key-ink"), corner: "full" }),
    connector: s(need("rule")),
    "verdict-right": s(need("sem-correct"), { ink: need("sem-correct-ink") }),
    "verdict-wrong": s(need("sem-incorrect"), { ink: need("sem-incorrect-ink") }),
    track: s(need("track-fill"), { ink: need("track-ink") }),
    scrim: s(need("scrim"), { ink: need("scrim-ink"), corner: 6 }),
  };
  const states: ThemeSurfaces["states"] = {
    "badge:now": s(need("badge-now"), { ink: need("now-ink"), corner: "full" }),
    "badge:inverse": s(need("now-ink"), { ink: need("badge-now"), corner: "full" }),
    "badge:ghost": s("transparent", {
      ink: need("muted"),
      line: need("rule"),
      lineWidth: 2,
      corner: "full",
    }),
    "chip:now": s(need("badge-now"), { ink: need("now-ink"), corner: "full" }),
    "chip:quiet": s(need("chip-quiet-fill"), { ink: need("chip-quiet-ink"), corner: "full" }),
    "card:flat": s(need("card-fill"), {
      ink: need("card-ink"),
      line: flatLine,
      lineWidth: flatLine ? px(need("card-flat-lw")) : undefined,
      corner: field,
    }),
    "card:right": s(need("card-fill"), {
      ink: need("card-ink"),
      line: need("sem-correct"),
      lineWidth: Math.max(2, px(need("card-lw"))),
      corner: field,
    }),
    "key:right": s(need("sem-correct"), { ink: need("key-ink"), corner: "full" }),
    "medal:tint": s(need("medal-tint"), {
      line: lineOf(need("medal-line")),
      lineWidth: lineOf(need("medal-line")) ? 2 : undefined,
      corner: "full",
    }),
    // The quick check's answer column as a solid block (round 4 themes4.css `.qc`: Poster's deep
    // teal with cream answers, Beacon's blue with white), where the theme sets one.
    ...(t["qc-field-fill"] && t["qc-field-ink"]
      ? {
          "field-b:inverse": s(t["qc-field-fill"], { ink: t["qc-field-ink"], corner: field }),
        }
      : {}),
  };
  withMarks(roles, states, marks, need("bg"));
  return {
    mode: need("mode") === "dark" ? "dark" : "light",
    ground: need("bg"),
    corner,
    titleMuted: need("title-muted"),
    nowInk: need("now-ink"),
    badgeNow: need("badge-now"),
    track: { fill: need("track-fill"), ink: need("track-ink") },
    medalTint: need("medal-tint"),
    chipQuiet: { fill: need("chip-quiet-fill"), ink: need("chip-quiet-ink") },
    cardFlat: { line: need("card-flat-line"), width: px(need("card-flat-lw")) },
    scrim: { fill: need("scrim"), ink: need("scrim-ink") },
    slots: [1, 2, 3, 4].map((n) => ({ fill: need(`cat-${n}-fill`), ink: need(`cat-${n}-ink`) })),
    dim: need("dim"),
    roles,
    states,
    zones: { top: band, "top-box": band, hero: null, inline: null },
    marks,
  };
}

/** The final token file, theme by theme (`tokens.json`, verbatim from the theming pass). */
export const SURFACE_TOKENS: Readonly<Record<string, SurfaceTokens>> = TOKENS as Record<
  string,
  SurfaceTokens
>;

/**
 * Night Lab is live and has no final tokens (part c retires it from the picker): Slate's set with
 * Night Lab's own palette, its theme-fit values (`theming/fit/fit.css`) and a deep medal under the
 * dark medal rule. Its pairs are held to the same contrast test as every other theme.
 */
const NIGHT_LAB: SurfaceTokens = {
  ...(TOKENS as Record<string, SurfaceTokens>)["dark-slate"],
  sand: "#22262D",
  "fa-fill": "#2A2620",
  "fb-fill": "#22262D",
  "card-fill": "#1C1F25",
  "card-line": "#343A44",
  "plate-fill": "#1C1F25",
  "plate-line": "#F2B551",
  "title-ink": "#ECEDEF",
  "title-accent": "#F2B551",
  "fa-ink": "#ECEDEF",
  "fb-ink": "#ECEDEF",
  "card-ink": "#ECEDEF",
  "badge-fill": "#ECEDEF",
  "badge-ink": "#131519",
  "badge-now": "#F2B551",
  "marker-fill": "#F2B551",
  "marker-ink": "#131519",
  "medal-fill": "#2E3440",
  "medal-tint": "#2E3440",
  "medal-line": "#3E4654",
  "chip-fill": "#22262D",
  "chip-ink": "#F2B551",
  "key-ink": "#131519",
  "sem-correct": "#86C7A8",
  "sem-incorrect": "#F08A7A",
  "sem-correct-ink": "#86C7A8",
  "sem-incorrect-ink": "#F08A7A",
  dim: "#868D98",
  "now-ink": "#131519",
  "title-muted": "#99A0AB",
  "track-fill": "#22262D",
  "track-ink": "#ECEDEF",
  "hl-a": "#3A3122",
  "hl-b": "#262B33",
  "set-a": "#3A3122",
  "set-b": "#23343A",
  "bubble-a": "#2A2620",
  "bubble-b": "#22262D",
  "chip-quiet-fill": "#22262D",
  "chip-quiet-ink": "#C9CED6",
  "card-flat-line": "#343A44",
  corner: "18px",
};

/** The palette keys a live theme owns: its surfaces are generated over these, never copied. */
const LIVE_BASE: readonly [string, keyof Theme["colors"]][] = [
  ["bg", "background"],
  ["surface", "surface"],
  ["ink", "ink"],
  ["muted", "muted"],
  ["accent", "accent"],
  ["rule", "line"],
];

/** Tokens a live theme's own palette needs retuned (none since the round 5 palettes, part c). */
const LIVE_RETUNE: Readonly<Record<string, SurfaceTokens>> = {};

/**
 * The token set a live theme paints with: its final tokens (or Night Lab's) with the theme's own
 * palette laid over them, so `SURFACES` and `themes.ts` cannot disagree on a ground or an ink.
 */
export function liveTokens(theme: Pick<Theme, "id" | "colors">): SurfaceTokens | undefined {
  const base = theme.id === "night-lab" ? NIGHT_LAB : SURFACE_TOKENS[theme.id];
  if (!base) return undefined;
  const own: SurfaceTokens = {};
  for (const [k, c] of LIVE_BASE) {
    const v = theme.colors[c];
    if (typeof v === "string") own[k] = v.toUpperCase();
  }
  return { ...base, ...own, ...LIVE_RETUNE[theme.id] };
}

/** Every token set in force: the 16 final themes, then each live theme over its own palette. */
export const SURFACE_TOKEN_SETS: Readonly<Record<string, SurfaceTokens>> = {
  ...SURFACE_TOKENS,
  ...Object.fromEntries(
    // Every theme a lesson can name: Night Lab left the picker (part c) but keeps its surfaces.
    ALL_THEMES.map((t) => [t.id, liveTokens(t)] as const).filter(
      (e): e is readonly [string, SurfaceTokens] => e[1] != null,
    ),
  ),
};

/** `SURFACES[themeId]`: every final theme and every live theme, one entry each. */
export const SURFACES: Readonly<Record<string, ThemeSurfaces>> = Object.fromEntries(
  Object.entries(SURFACE_TOKEN_SETS).map(([id, t]) => [id, surfacesFromTokens(t)] as const),
);

/**
 * The token set a theme paints with: its own, or for a theme the table does not know Paper's (Slate's
 * when dark). `surfacesOf` and the dim tones read this one fallback.
 */
const tableId = (theme: Pick<Theme, "id" | "dark">): string =>
  theme.id in SURFACE_TOKEN_SETS ? theme.id : theme.dark ? "dark-slate" : "paper";

/**
 * A theme's title band (THEMING.md look table: Poster's full-bleed teal band, cream ink, yellow
 * accent), or null when its title sits on the ground.
 */
export function titleBand(
  theme: Pick<Theme, "id">,
): { fill: string; ink: string; accent: string } | null {
  const k = SURFACE_TOKEN_SETS[theme.id];
  const fill = k?.["title-band"];
  if (!k || !fill || isClear(fill)) return null;
  return { fill, ink: k["title-ink"] ?? "", accent: k["title-accent"] ?? "" };
}

/** A theme's surfaces; one the table does not know takes Paper's, or Slate's when dark. */
export const surfacesOf = (theme: Pick<Theme, "id" | "dark">): ThemeSurfaces =>
  SURFACES[tableId(theme)] as ThemeSurfaces;

/** The least contrast the dim tone keeps on its ground (ruling 248, WCAG AA body text). */
export const DIM_CONTRAST = 4.5;

/**
 * The dim tone and the ground it sits on. A theme in the table takes its own `dim` and `bg` tokens
 * (each set is tested at 4.5:1). A custom or unknown theme takes its own background and its muted
 * ink, stepped toward its ink, then to black or white, until it reads at 4.5:1 there: Paper's
 * tokens on another theme's ground would promise a contrast nobody measured.
 */
function dimPair(theme: Pick<Theme, "id" | "dark" | "colors">): { ink: string; ground: string } {
  const own = SURFACE_TOKEN_SETS[theme.id];
  if (own?.dim && own.bg) return { ink: own.dim, ground: own.bg };
  const ground = theme.colors.background;
  const { muted, ink } = theme.colors;
  for (let amount = 0; amount <= 1; amount += 0.05) {
    const tone = mix(ink, muted, amount);
    if (contrastRatio(tone, ground) >= DIM_CONTRAST) return { ink: tone, ground };
  }
  const black = contrastRatio("#000000", ground) >= contrastRatio("#FFFFFF", ground);
  return { ink: black ? "#000000" : "#FFFFFF", ground };
}

/**
 * The theme's dim text tone (ruling 248, at least 4.5:1 on `dimGround`): text that steps back,
 * such as a hinge's wrong options after the reveal (ruling 258), never faded or see-through.
 */
export const dimInk = (theme: Pick<Theme, "id" | "dark" | "colors">): string => dimPair(theme).ink;

/**
 * The ground a stepped-back card takes (TEACH-256 part d): the slide's own ground, quieter than a
 * card, which the dim tone reads on at 4.5:1 or better (ruling 248, "dim on ground").
 */
export const dimGround = (theme: Pick<Theme, "id" | "dark" | "colors">): string =>
  dimPair(theme).ground;

/** The style for a role in a state (a state the theme does not set paints as the plain role). */
export function surfaceStyle(
  theme: Pick<Theme, "id" | "dark">,
  role: SurfaceRole,
  state?: SurfaceState,
): SurfaceStyle {
  const s = surfacesOf(theme);
  return (state && s.states[`${role}:${state}`]) || s.roles[role];
}

/** Corners as [top-left, top-right, bottom-right, bottom-left], in points. */
export type Corners = readonly [number, number, number, number];

/**
 * The four corners a surface draws. A full role is a disc or pill (half the short side). A fixed
 * theme corner replaces only the corners the layout rounded, so a bleed side stays square;
 * `"own"` keeps the layout's corners as they are.
 */
export function cornerRadii(
  style: SurfaceStyle,
  box: { w: number; h: number },
  own: Corners = [0, 0, 0, 0],
): Corners {
  if (style.corner === "full") {
    const r = Math.min(box.w, box.h) / 2;
    return [r, r, r, r];
  }
  if (style.corner === "own") return own;
  const r = style.corner;
  const anyOwn = own.some((c) => c > 0);
  return anyOwn ? (own.map((c) => (c > 0 ? r : 0)) as unknown as Corners) : [r, r, r, r];
}

export type Box = { x: number; y: number; w: number; h: number };

/** Text closer than this to a field's top keeps the band its own pad (THEME-FIT fix 14). */
export const BAND_JOIN_CLEAR = 24;
/** A field further than this below the title is not joined. */
export const BAND_JOIN_REACH = 72;

/**
 * Band join, written at layout time: if a field (or frame) starts 1-72pt below a top title and no
 * text outside the field starts within 24pt of its top, the band runs down to meet it. Returns
 * how far past the title's foot the band reaches, or null to keep the pad. Paint only.
 */
export function bandJoin(title: Box, fields: readonly Box[], texts: readonly Box[]): number | null {
  const foot = title.y + title.h;
  const field = fields
    .filter((f) => f.y > foot && f.y - foot <= BAND_JOIN_REACH)
    .sort((a, b) => a.y - b.y)[0];
  if (!field) return null;
  const blocked = texts.some(
    (t) =>
      t.h > 0 &&
      t.y > foot &&
      t.y < field.y + BAND_JOIN_CLEAR &&
      !(t.x >= field.x && t.x + t.w <= field.x + field.w),
  );
  return blocked ? null : Math.round(field.y - foot);
}

/** What a layout asks to have painted: a role on a box, with the layout's own corners. */
export type SurfaceSpec = {
  role: SurfaceRole;
  state?: SurfaceState;
  /** For a title: its zone. A band is only ever drawn on a banded zone. */
  zone?: TitleZone;
  box: Box;
  /** The layout's corners, TL TR BR BL; used when the theme keeps the layout's own. */
  own?: Corners;
  /** A title band's join (`bandJoin`), added below the box. */
  join?: number | null;
  id: string;
};

/** `#RRGGBBAA` as a colour and an opacity; anything else passes through. */
export function splitAlpha(c: string): { color: string; opacity?: number } {
  const m = /^(#[0-9a-f]{6})([0-9a-f]{2})$/i.exec(c);
  if (!m) return { color: c };
  const a = Number.parseInt(m[2] as string, 16) / 255;
  return { color: (m[1] as string).toUpperCase(), opacity: Math.round(a * 1000) / 1000 };
}

/** `#RRGGBB` as `rgb(r, g, b)`. */
export const rgbOf = (hex: string): string =>
  `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

/** Points per quarter arc on an own-corner path: smooth at slide scale, native in PPTX. */
const ARC_STEPS = 8;

/** A rounded rectangle with four radii as a closed path in box fractions (TL, TR, BR, BL). */
export function roundRectPoints(w: number, h: number, r: Corners): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const cap = (v: number) => Math.max(0, Math.min(v, w / 2, h / 2));
  const [tl, tr, br, bl] = r.map(cap) as unknown as Corners;
  const arc = (cx: number, cy: number, rad: number, from: number) => {
    if (rad === 0) {
      pts.push({ x: cx, y: cy });
      return;
    }
    for (let i = 0; i <= ARC_STEPS; i++) {
      const a = ((from + (90 * i) / ARC_STEPS) * Math.PI) / 180;
      pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
    }
  };
  arc(tl ? tl : 0, tl ? tl : 0, tl, 180);
  arc(tr ? w - tr : w, tr ? tr : 0, tr, 270);
  arc(br ? w - br : w, br ? h - br : h, br, 0);
  arc(bl ? bl : 0, bl ? h - bl : h, bl, 90);
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return pts.map((p) => ({ x: round(p.x / w), y: round(p.y / h) }));
}

/** The element name a painted surface carries in the layers list. */
export const surfaceName = (role: SurfaceRole, state?: SurfaceState) =>
  `surface:${role}${state ? `:${state}` : ""}`;

/**
 * One role as one element, drawn under its content: a native shape when the corners agree (a
 * disc for full roles, a rounded or square rect), a closed path when they differ. Null when the
 * role paints nothing here (a clear fill and no line, or a band on an unbanded zone).
 */
export function paintSurface(
  spec: SurfaceSpec,
  theme: Pick<Theme, "id" | "dark">,
): ShapeElement | PathElement | null {
  const s = surfacesOf(theme);
  const style =
    spec.role === "title"
      ? spec.zone && BANDED_ZONES.has(spec.zone)
        ? s.zones[spec.zone]
        : null
      : surfaceStyle(theme, spec.role, spec.state);
  if (!style) return null;
  if (spec.role === "kicker") return null;
  if (isClear(style.fill) && !style.line) return null;
  const box = { ...spec.box, h: spec.box.h + (spec.role === "title" ? (spec.join ?? 0) : 0) };
  // A clear role (a ghost disc) is filled with the ground: PowerPoint has no "none" a shape keeps.
  const split = splitAlpha(isClear(style.fill) ? s.ground : style.fill);
  const { opacity } = split;
  // The scrim is locked: written as rgb() so render-time re-theming (`themedColour`, which reads
  // any hex that is some theme's token as that token) never swaps it for a theme's pale ink.
  const fill = spec.role === "scrim" ? rgbOf(split.color) : split.color;
  const base = {
    id: spec.id,
    name: surfaceName(spec.role, spec.state),
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    locked: true,
    ...(opacity != null && opacity < 1 ? { opacity } : {}),
  };
  const stroke = style.line && !isClear(style.line) ? style.line : undefined;
  const lines = stroke ? { stroke, strokeWidth: style.lineWidth ?? 2 } : {};
  const extra = {
    ...(style.shadow ? { shadow: { ...style.shadow } } : {}),
    ...(style.tilt ? { rotation: style.tilt } : {}),
  };
  // A dashed or dotted rule: one stroke along the bar's middle, as thick as the bar.
  if (spec.role === "rule" && style.dash) {
    return {
      ...base,
      type: "path",
      points: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
      stroke: fill,
      strokeWidth: Math.max(1.5, box.h),
      dash: style.dash,
      dashGap: style.dash === "dotted" ? 1.6 : 1.2,
    };
  }
  // A theme's mark shape (THEMING.md section 6): a labelled mark stays a native shape kind so
  // it keeps its label; a torn field is a closed path, its slide-edge sides kept straight.
  if (style.shape === "torn") {
    return {
      ...base,
      type: "path",
      points: tornPoints(box.w, box.h, innerSides(box), style.edge ?? 5),
      closed: true,
      fill,
      ...(stroke ? lines : { strokeWidth: 0 }),
    };
  }
  if (style.shape === "notch" && FIELD_LIKE.has(spec.role)) {
    return {
      ...base,
      type: "path",
      points: notchPoints(box.w, box.h, style.edge ?? 8, ALL_CUT.has(spec.role) ? "all" : "diag"),
      closed: true,
      fill: isClear(style.fill) ? "transparent" : fill,
      ...(stroke ? lines : { strokeWidth: 0 }),
    };
  }
  if (style.shape) {
    return {
      ...base,
      type: "shape",
      shape: style.shape,
      ...(style.shape === "notch" ? { radius: style.edge ?? 8 } : {}),
      fill: isClear(style.fill) ? "transparent" : fill,
      ...lines,
      ...extra,
    };
  }
  const r = cornerRadii(style, box, spec.own);
  const same = r.every((c) => c === r[0]);
  if (style.corner === "full" && box.w === box.h) {
    return { ...base, type: "shape", shape: "ellipse", fill, ...lines, ...extra };
  }
  if (style.corner === "full") {
    return { ...base, type: "shape", shape: "pill", fill, ...lines, ...extra };
  }
  if (same || style.shadow) {
    return {
      ...base,
      type: "shape",
      shape: r[0] > 0 ? "rounded" : "rect",
      ...(r[0] > 0 ? { radius: r[0] } : {}),
      fill,
      ...lines,
      ...extra,
    };
  }
  return {
    ...base,
    type: "path",
    points: roundRectPoints(box.w, box.h, r),
    closed: true,
    fill,
    // A path with no stroke would draw the renderer's default ink line: a role with no line says 0.
    ...(stroke ? lines : { strokeWidth: 0 }),
  };
}

/** A labelled mark's drawing: the shape kind and its paint, for a layout that sets its own colours. */
export type MarkLook = {
  shape: ShapeElement["shape"];
  radius?: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  /** The glyph's colour. */
  ink: string;
  rotation?: number;
  shadow?: { x: number; y: number; color: string };
};

/**
 * A badge, key, medal or chip in the theme's family (THEMING.md section 6), for a layout that
 * picks its own fill and glyph colours (the worked rail's now and done badges, the hinge key):
 * a disc stays a disc, a hex a hexagon, an outline a ring in the fill colour on no fill, a sticky
 * key the theme's sticky paper with the ink letter, tilted.
 */
export function markLook(
  theme: Pick<Theme, "id" | "dark">,
  family: "badge" | "key" | "medal" | "chip",
  d: number,
  asked: string,
  ink: string,
): MarkLook {
  const look = familyLook(theme, family, d, asked, ink);
  // Scrapbook's badges turn a few degrees (round 2 `--badge-tilt`), as a sticker does.
  const tilt = family === "badge" ? surfacesOf(theme).marks.badgeTilt : 0;
  return tilt && !look.rotation ? { ...look, rotation: tilt } : look;
}

function familyLook(
  theme: Pick<Theme, "id" | "dark">,
  family: "badge" | "key" | "medal" | "chip",
  d: number,
  asked: string,
  ink: string,
): MarkLook {
  const m = surfacesOf(theme).marks;
  const kind = m[family];
  // An outline family's role is drawn as a ring on no fill: a caller that asks for the role's own
  // fill (the hinge key in its theme's colour, Calm's teal) means the ring's colour.
  const fill = isClear(asked) ? (surfacesOf(theme).roles[family].line ?? ink) : asked;
  switch (kind) {
    case "disc":
      return { shape: "ellipse", fill, ink };
    case "pill":
      return { shape: "pill", fill, ink };
    case "square":
      return { shape: "rect", fill, ink };
    case "tile":
      return {
        shape: "rect",
        fill,
        ink,
        ...(m.offset ? { shadow: { x: 4, y: 4, color: m.offset.color } } : {}),
      };
    case "rounded":
    case "tag":
      return { shape: "rounded", radius: Math.round(d * 0.24), fill, ink };
    case "hex":
      return { shape: "hexagon", fill, ink };
    case "notch":
      // roles2.css notch key: `polygon(22% 0, ...)`, the cut 22% of the key (14px of 64), unrounded.
      return { shape: "notch", radius: Math.max(4, Math.round(d * 22) / 100), fill, ink };
    case "outline":
      return {
        shape: family === "badge" ? "ellipse" : "rounded",
        radius: Math.round(d * 0.16),
        fill: "transparent",
        stroke: fill,
        strokeWidth: 2.5,
        ink: fill,
      };
    case "sticky":
      return {
        shape: "rect",
        fill: m.sticky?.fill ?? fill,
        ink: surfacesOf(theme).roles.card.ink ?? ink,
        rotation: m.sticky?.tilt ?? 0,
      };
  }
}
