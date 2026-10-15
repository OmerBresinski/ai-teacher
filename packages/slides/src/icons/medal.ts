/*
 * Icons sit in medals (TEACH-310 part c, rulings 211 and 247): a round disc whose face is a theme
 * token, the drawing at 80% of the disc on top. The drawings are made for a light face, so a
 * category colour never fills the disc; it may only ring it (TEACH-75 part u).
 *
 * The medal tokens (`medal-fill`, `medal-tint`, `medal-line`, theming/final) belong to the theme.
 * A theme that carries them passes them as `medal`; for one that does not yet, `medalColoursFor`
 * derives them with the final token set's rule (build-tokens.mjs, Greg 15 Oct 2026):
 * - light themes: a white face, a pale accent tint as the tinted face, no ring;
 * - dark themes: a DEEP face in the accent's hue just above the lightest of the ground, the
 *   surface and the fields (OKLCH L + 0.075, chroma 0.03), so the icon is the brightest thing in
 *   the disc, and a quiet ring (L + 0.14) so the edge holds on a panel of a close tone. Light faces
 *   on a dark slide were "too light, garish and obscure the icons".
 */
import { type IconSvgOptions, iconBody, pxAttrs } from "./library";
import { fromOklch, mixOklab, safeHex, toOklch } from "./treatment";

export interface MedalColours {
  /** the face (`medal-fill`) */
  fill: string;
  /** the tinted face (`medal-tint`), for a medal that should not read white on a white card */
  tint: string;
  /** the ring (`medal-line`), or null for none */
  line: string | null;
}

/** The parts of a theme the medal reads, typed structurally so this module imports no theme. */
export interface MedalThemeInput {
  dark?: boolean;
  colors: { background: string; surface?: string; accent: string };
  /** the theme's field fills (field a, field b, ...): a medal may sit on any of them */
  fields?: readonly string[];
  /** the theme's own medal tokens; each one given wins over the derived one */
  medal?: Partial<MedalColours>;
}

/** A theme colour that is transparent (#rrggbb00) or not a colour means "no ring". */
function ringOf(value: string | null | undefined): string | null {
  if (typeof value !== "string" || /^#[0-9a-fA-F]{6}00$/.test(value)) return null;
  const hex = safeHex(value, "");
  return hex || null;
}

export function medalColoursFor(theme: MedalThemeInput): MedalColours {
  const bg = safeHex(theme.colors?.background, "#ffffff");
  const accent = safeHex(theme.colors?.accent, "#d7263d");
  const own = theme.medal ?? {};
  let derived: MedalColours;
  if (theme.dark) {
    const grounds = [bg, theme.colors?.surface, ...(theme.fields ?? [])]
      .map((c) => safeHex(c, ""))
      .filter(Boolean);
    const top = Math.max(...grounds.map((c) => toOklch(c)[0]));
    const hue = toOklch(accent)[2];
    const deep = fromOklch(top + 0.075, 0.03, hue);
    derived = { fill: deep, tint: deep, line: fromOklch(top + 0.14, 0.035, hue) };
  } else {
    derived = { fill: "#ffffff", tint: mixOklab(accent, bg, 0.1), line: null };
  }
  return {
    fill: safeHex(own.fill, derived.fill),
    tint: safeHex(own.tint, derived.tint),
    line: own.line === undefined ? derived.line : ringOf(own.line),
  };
}

export interface MedalSvgOptions extends IconSvgOptions {
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

/**
 * A library icon in a medal, as one self-contained SVG with literal colours (so PPTX rasterises it
 * like any icon). The disc is opaque and the corners outside it are empty, so a rasteriser keeps
 * them transparent. "" for an unknown id.
 */
export function iconMedalSvg(id: string, opts: MedalSvgOptions): string {
  const body = iconBody(id, opts);
  if (!body) return "";
  const face = safeHex(opts.face === "tint" ? opts.medal.tint : opts.medal.fill, "#ffffff");
  const ring = opts.ring ? safeHex(opts.ring, "") : "";
  const line = ringOf(opts.medal.line);
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
  const inset = Math.round(120 * (1 - ICON_SHARE));
  parts.push(`<g transform="translate(${inset} ${inset}) scale(${ICON_SHARE})">${body}</g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"${pxAttrs(opts.px)}>${parts.join("")}</svg>`;
}
