/*
 * Icons sit in medals (TEACH-310 part c, rulings 211 and 247): a round disc whose face is a theme
 * token, the drawing at 80% of the disc on top. The drawings are made for a light face, so a
 * category colour never fills the disc; it may only ring it (TEACH-75 part u).
 *
 * The medal tokens belong to the theme: `medal-fill`, `medal-tint` and `medal-line` in the theme's
 * kebab token record (theming/final/tokens.json, the names TEACH-215 part b reads). A theme passes
 * that record as `tokens` and the medal uses them as they are. Only for a theme without them does
 * `medalColoursFor` derive them, with the final token set's rule (build-tokens.mjs, 15 Oct 2026):
 * - light themes: the theme's surface as the face, a pale accent tint as the tinted face, no ring;
 * - dark themes: a DEEP face in the accent's hue just above the lightest of the ground, the
 *   surface and the fields (OKLCH L + 0.075, chroma 0.03), so the icon is the brightest thing in
 *   the disc, and a quiet ring (L + 0.14) so the edge holds on a panel of a close tone. Light faces
 *   on a dark slide were "too light, garish and obscure the icons".
 */
import { type IconSvgOptions, iconBody, iconSignificantColours, pxAttrs } from "./library";
import { contrast, fromOklch, mixOklab, safeHex, toOklch } from "./treatment";

export interface MedalColours {
  /** the face (`medal-fill`) */
  fill: string;
  /** the tinted face (`medal-tint`), for a medal that should not read white on a white card */
  tint: string;
  /** the ring (`medal-line`), or null for none */
  line: string | null;
  /** dark themes: the ring's hue, for the light rim behind a dark icon */
  dark?: boolean;
}

/** The theme's kebab tokens the medal reads (theming/final/tokens.json names). */
export type MedalTokens = Partial<
  Record<
    | "medal-fill"
    | "medal-tint"
    | "medal-line"
    | "bg"
    | "surface"
    | "fa-fill"
    | "fb-fill"
    | "accent",
    string
  > & { mode: string }
>;

/** The parts of a theme the medal reads, typed structurally so this module imports no theme. */
export interface MedalThemeInput {
  dark?: boolean;
  /** the theme's token record; its medal tokens win, its grounds feed the fallback */
  tokens?: MedalTokens;
  colors?: { background?: string; surface?: string; accent?: string };
  /** the theme's field fills (field a, field b, ...): a medal may sit on any of them */
  fields?: readonly string[];
}

/** A theme colour that is transparent (#rrggbb00), "transparent" or not a colour: no ring. */
function ringOf(value: string | null | undefined): string | null {
  if (typeof value !== "string" || /^#[0-9a-fA-F]{6}00$/.test(value)) return null;
  const hex = safeHex(value, "");
  return hex || null;
}

export function medalColoursFor(theme: MedalThemeInput): MedalColours {
  const t = theme.tokens ?? {};
  const bg = safeHex(t.bg ?? theme.colors?.background, "");
  const surface = safeHex(t.surface ?? theme.colors?.surface, "") || bg;
  const accent = safeHex(t.accent ?? theme.colors?.accent, "") || bg;
  const dark = theme.dark ?? t.mode === "dark";
  let derived: MedalColours;
  if (dark) {
    const grounds = [bg, surface, t["fa-fill"], t["fb-fill"], ...(theme.fields ?? [])]
      .map((c) => safeHex(c, ""))
      .filter(Boolean);
    const top = Math.max(0, ...grounds.map((c) => toOklch(c)[0]));
    const hue = accent ? toOklch(accent)[2] : 0;
    const deep = fromOklch(top + 0.075, 0.03, hue);
    derived = { fill: deep, tint: deep, line: fromOklch(top + 0.14, 0.035, hue) };
  } else {
    const tint = accent && bg ? mixOklab(accent, bg, 0.1) : surface;
    derived = { fill: surface, tint, line: null };
  }
  return {
    fill: safeHex(t["medal-fill"], derived.fill),
    tint: safeHex(t["medal-tint"], derived.tint),
    line: t["medal-line"] === undefined ? derived.line : ringOf(t["medal-line"]),
    dark,
  };
}

export interface MedalSvgOptions extends IconSvgOptions {
  /** The medal outline: a disc (default) or a theme's hexagon (Geometric). */
  shape?: "disc" | "hex";
  medal: MedalColours;
  /** which face: the plain fill (default) or the tint */
  face?: "fill" | "tint";
  /** a category colour as a ring round the face (the drawing never sits on a full colour disc) */
  ring?: string;
}

/** The disc is the 240 box; the quiet ring is about 2px on a 80px medal, the category ring 5px. */
const QUIET_RING = 6;
const CATEGORY_RING = 14;
const ICON_SHARE = 0.8;
/** The least contrast an icon's dominant shape keeps against what is right behind it. */
export const MEDAL_MIN_CONTRAST = 3;
/** The rim's width round each shape, in the drawing's 240 units. */
const RIM = 14;

/**
 * The light rim colour that lifts a dark icon off a deep face: the ring's hue, lightened until each
 * of the icon's large shapes that read under 3:1 on the face reads at 3:1 against the rim. Null
 * when every large shape already reads on the face, or no rim tint can lift them all.
 */
export function medalRim(id: string, opts: MedalSvgOptions): string | null {
  const face = faceOf(opts);
  const weak = iconSignificantColours(id, opts).filter(
    (c) => contrast(c, face) < MEDAL_MIN_CONTRAST,
  );
  if (!weak.length) return null;
  const [L0, , hue] = toOklch(ringOf(opts.medal.line) ?? face);
  const darkIcon = weak.some((c) => toOklch(c)[0] < toOklch(face)[0]) || opts.medal.dark;
  for (let L = L0; L >= 0 && L <= 1; L += darkIcon ? 0.02 : -0.02) {
    const rim = fromOklch(L, 0.03, hue);
    if (weak.every((c) => contrast(c, rim) >= MEDAL_MIN_CONTRAST)) return rim;
  }
  return null;
}

const faceOf = (opts: MedalSvgOptions) =>
  safeHex(
    opts.face === "tint" ? opts.medal.tint : opts.medal.fill,
    safeHex(opts.medal.fill, "#808080"),
  );

/** The drawing again, every part in the rim colour and widened, to sit behind the drawing. */
function rimOf(body: string, rim: string): string {
  return body
    .replace(/<defs>.*?<\/defs>|<clipPath\b.*?<\/clipPath>|<marker\b.*?<\/marker>/g, "")
    .replace(/ id="[^"]*"/g, "")
    .replace(/ marker-end="[^"]*"/g, "")
    .replace(/ style="([^"]*)"/g, (_, style: string) => {
      const width = /stroke-width:([\d.]+)/.exec(style);
      const w = (width ? Number.parseFloat(width[1] as string) : 0) + RIM;
      const kept = style
        .split(";")
        .filter((d) => /^(opacity|stroke-linecap)$/.test(d.split(":")[0]?.trim() ?? "") === false)
        .filter(
          (d) =>
            !/^(fill|stroke|stroke-width|stroke-opacity|paint-order|stroke-linejoin)\s*:/.test(
              d.trim(),
            ),
        );
      const fill = /fill:none/.test(style) ? "none" : rim;
      return ` style="${[...kept, `fill:${fill}`, `stroke:${rim}`, `stroke-width:${w}`, "stroke-linejoin:round", "stroke-linecap:round"].filter(Boolean).join(";")}"`;
    });
}

/**
 * A library icon in a medal, as one self-contained SVG with literal colours (so PPTX rasterises it
 * like any icon). The disc is opaque and the corners outside it are empty, so a rasteriser keeps
 * them transparent. An icon whose dominant shape would read under 3:1 on the face (a black penguin
 * on a deep dark face) gets a soft light rim behind it, on that theme only. "" for an unknown id.
 */
export function iconMedalSvg(id: string, opts: MedalSvgOptions): string {
  const body = iconBody(id, opts);
  if (!body) return "";
  const face = faceOf(opts);
  const ring = opts.ring ? safeHex(opts.ring, "") : "";
  const line = ringOf(opts.medal.line);
  // Geometric's hexagon medal (THEMING.md section 6 `--medal-shape: hex`): the same face and
  // ring as a flat-topped hexagon, the editor's and PPTX's 25% side cut.
  if (opts.shape === "hex") {
    const hex = (i: number) =>
      [
        `${60 + i / 2},${i}`,
        `${180 - i / 2},${i}`,
        `${240 - i},120`,
        `${180 - i / 2},${240 - i}`,
        `${60 + i / 2},${240 - i}`,
        `${i},120`,
      ].join(" ");
    const edge = ring || line;
    const w = ring ? CATEGORY_RING : QUIET_RING;
    const rim = medalRim(id, opts);
    const inset = Math.round(120 * (1 - ICON_SHARE));
    const svgParts = [
      `<polygon points="${hex(0)}" style="fill:${face}"/>`,
      ...(edge
        ? [
            `<polygon points="${hex(w / 2)}" style="fill:none;stroke:${edge};stroke-width:${w};stroke-linejoin:round"/>`,
          ]
        : []),
      `<g transform="translate(${inset} ${inset}) scale(${ICON_SHARE})">${rim ? `<g style="opacity:0.9">${rimOf(body, rim)}</g>` : ""}${body}</g>`,
    ];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"${pxAttrs(opts.px)}>${svgParts.join("")}</svg>`;
  }
  const parts = [`<circle cx="120" cy="120" r="120" style="fill:${face}"/>`];
  if (ring) {
    const r = 120 - CATEGORY_RING / 2;
    parts.push(
      `<circle cx="120" cy="120" r="${r}" style="fill:none;stroke:${ring};stroke-width:${CATEGORY_RING}"/>`,
    );
  } else if (line) {
    const r = 120 - QUIET_RING / 2;
    parts.push(
      `<circle cx="120" cy="120" r="${r}" style="fill:none;stroke:${line};stroke-width:${QUIET_RING}"/>`,
    );
  }
  const rim = medalRim(id, opts);
  const inset = Math.round(120 * (1 - ICON_SHARE));
  parts.push(
    `<g transform="translate(${inset} ${inset}) scale(${ICON_SHARE})">${rim ? `<g style="opacity:0.9">${rimOf(body, rim)}</g>` : ""}${body}</g>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"${pxAttrs(opts.px)}>${parts.join("")}</svg>`;
}

/** The medal as an SVG data URL for an image element's `src` (PPTX rasterises it like an icon). */
export function iconMedalImageSrc(id: string, opts: MedalSvgOptions): string {
  const svg = iconMedalSvg(id, opts);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : "";
}
