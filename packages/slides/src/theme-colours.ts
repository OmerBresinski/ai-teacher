import {
  mapRunColours,
  type RichDoc,
  type Slide,
  type SlideElement,
  type Theme,
} from "@tj/domain/documents";
import { resolveTextStyle } from "./text-style";
import { THEMES } from "./themes";
import { isClear, SURFACE_TOKEN_SETS, titleBand } from "./themes/surfaces";

/*
 * Theme colours at render time. Generation writes the look's colours into the elements (a card's
 * surface fill, the accent bar, a kind tag's accent), so a lesson moved to another theme kept the
 * first theme's cards: cream cards under Night Lab's pale ink, an orange bar on Playground. Every colour that is one of any theme's tokens is read as that token and drawn
 * in the slide's own theme. A colour no theme uses (the teacher's own) is left as it is.
 */

type Token = keyof Theme["colors"];

/** Tokens in the order a shared hex is read as: a card's white is its surface, not the ground. */
const ORDER: Token[] = [
  "accent",
  "surface",
  "panel",
  "line",
  "onAccent",
  "accent2",
  "heading",
  "muted",
  "ink",
  "background",
  "correct",
  "incorrect",
];

const TOKEN_OF = (() => {
  const map = new Map<string, Token>();
  for (const token of ORDER) {
    for (const t of THEMES) {
      const hex = t.colors[token];
      if (typeof hex === "string" && !map.has(hex.toLowerCase())) map.set(hex.toLowerCase(), token);
    }
  }
  return map;
})();

const ownColour = (colour: string, theme: Theme) =>
  Object.values(theme.colors).some(
    (v) => typeof v === "string" && v.toLowerCase() === colour.toLowerCase(),
  );

/** `colour` in `theme`: the same token's value when it is a theme token, else as given. */
export function themedColour(colour: string | undefined, theme: Theme): string | undefined {
  if (!colour) return colour;
  const token = TOKEN_OF.get(colour.toLowerCase());
  if (!token) return colour;
  // One of this theme's own colours stays itself: a hex another theme gives a different token
  // (Storytime's incorrect red is Paper's accent) is not moved to this theme's value for that
  // token (TEACH-215 part c). A card's surface is the exception: Exam Hall draws white cards grey.
  if (token !== "surface" && ownColour(colour, theme)) return colour;
  const own = theme.colors[token];
  if (typeof own === "string") return own;
  // A token this theme leaves unset (panel, heading) falls back as the renderer does.
  return token === "heading" ? theme.colors.ink : token === "panel" ? theme.colors.surface : colour;
}

const themedDoc = (doc: RichDoc, theme: Theme): RichDoc =>
  mapRunColours(doc, (c) => themedColour(c, theme));

/*
 * The title band (Poster's `title-treat: band`, TEACH-215 part k) is the title role, not a colour:
 * its fill, the heading's ink on it and the accent word on it are each banded theme's own tokens.
 * Drawn in another theme they become that theme's band, or no band and its own heading ink and
 * accent, so a heading laid out on Poster never stays cream on a cream ground.
 */
const BANDS = Object.values(SURFACE_TOKEN_SETS).filter(
  (k) => k["title-band"] && !isClear(k["title-band"]),
);
const lower = (v: string | undefined) => (v ?? "").toLowerCase();
const BAND_FILLS = new Set(BANDS.map((k) => lower(k["title-band"])));
const BAND_INKS = new Set(BANDS.map((k) => lower(k["title-ink"])));
const BAND_ACCENTS = new Set(BANDS.map((k) => lower(k["title-accent"])));
const CLEAR = "transparent";

type Box = { x: number; y: number; w: number; h: number };
/** The band a slide was laid out with (any banded theme's title band), or null. */
const bandOf = (els: readonly SlideElement[]): Box | null =>
  (els.find(
    (e) => e.name === "surface:title" && e.type === "shape" && BAND_FILLS.has(lower(e.fill)),
  ) as Box | undefined) ?? null;
const inside = (e: Box, b: Box) => e.y + e.h <= b.y + b.h + 1 && e.x + e.w <= b.x + b.w + 1;

function bandedElement(e: SlideElement, theme: Theme, band: Box | null): SlideElement | null {
  if (!band) return null;
  if (e.name === "surface:title" && e.type === "shape" && BAND_FILLS.has(lower(e.fill)))
    return { ...e, fill: titleBand(theme)?.fill ?? CLEAR };
  if (e.type !== "text" || !inside(e, band)) return null;
  const style = e.style as { color?: string } | undefined;
  if (!style?.color || !BAND_INKS.has(lower(style.color))) return null;
  const own = titleBand(theme);
  const ink =
    own?.ink ??
    (e.name === "Heading" ? (theme.colors.heading ?? theme.colors.ink) : theme.colors.ink);
  const accent = own?.accent ?? theme.colors.accent;
  return {
    ...e,
    style: { ...e.style, color: ink },
    doc: mapRunColours(e.doc, (c) =>
      BAND_INKS.has(lower(c)) ? ink : BAND_ACCENTS.has(lower(c)) ? accent : themedColour(c, theme),
    ),
  } as SlideElement;
}

function themedElement(
  e: SlideElement,
  theme: Theme,
  docs: boolean,
  band: Box | null = null,
): SlideElement {
  const banded = bandedElement(e, theme, band);
  if (banded) return banded;
  const out = { ...e } as Record<string, unknown> & SlideElement;
  for (const key of ["fill", "stroke", "color"] as const) {
    const v = (e as Record<string, unknown>)[key];
    if (typeof v === "string") out[key] = themedColour(v, theme);
  }
  const style = (e as { style?: { color?: string } }).style;
  if (style?.color) out.style = { ...style, color: themedColour(style.color, theme) };
  const ts = (e as { textStyle?: { color?: string } }).textStyle;
  if (ts?.color) out.textStyle = { ...ts, color: themedColour(ts.color, theme) };
  const doc = (e as { doc?: RichDoc }).doc;
  if (doc && docs) out.doc = themedDoc(doc, theme);
  return out;
}

/**
 * The slide with every theme-token colour drawn in `theme`. `docs: false` leaves each element's
 * rich text as stored: the editor seeds Tiptap from the doc it draws and saves what Tiptap holds,
 * so a themed doc there would write the remapped colours into the lesson on the first keystroke.
 */
export function withThemeColours(
  slide: Slide,
  theme: Theme,
  { docs = true }: { docs?: boolean } = {},
): Slide {
  const band = bandOf(slide.elements);
  const elements = slide.elements.map((e) => themedElement(e, theme, docs, band));
  return {
    ...slide,
    elements: elements.map((e, i) => {
      const read = readable(slide.elements, elements, i, theme);
      // A stored layout group (TEACH-75 part ap): its children are drawn as laid out, so words a
      // layout put straight on the slide (a pilot slide saved before layouts painted their own
      // ground) sit on whatever ground the deck's theme now draws.
      const kids = (e as { children?: SlideElement[] }).children;
      if (e.type !== "group" || !kids?.length) return read;
      return {
        ...read,
        children: kids.map((_k, k) => readable(kids, kids, k, theme, true)),
      } as SlideElement;
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Words on a kept field (TEACH-75 part ap)                            */
/* ------------------------------------------------------------------ */

/** WCAG relative luminance of a #rrggbb colour. */
function lum(hex: string): number {
  const ch = (i: number) => {
    const v = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
}
const HEX = /^#[0-9a-f]{6}$/i;
/** WCAG contrast of two #rrggbb colours (1 when either is not one). */
function contrast(a: string, b: string): number {
  if (!HEX.test(a) || !HEX.test(b)) return 21;
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

type Boxed = { type: string; x: number; y: number; w: number; h: number; fill?: string };

/** Index of the last shape drawn before `i` that covers the middle of `i`'s first line, or -1. */
function under(els: readonly SlideElement[], i: number): number {
  const e = els[i] as unknown as Boxed;
  const cx = e.x + e.w / 2;
  const cy = e.y + Math.min(e.h, 40) / 2;
  for (let j = i - 1; j >= 0; j--) {
    const b = els[j] as unknown as Boxed;
    if (b.type !== "shape" || typeof b.fill !== "string" || !HEX.test(b.fill)) continue;
    if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) return j;
  }
  return -1;
}

/**
 * A layout's field is often a tint mixed from its theme (split compare's sides), which no theme
 * names, so it keeps its colour when the lesson moves theme while the words on it take the new
 * theme's ink (Splash's pale fields under Night Lab's pale ink); or the field moves and the words,
 * in an untokened tint, stay. Where the move left words that no longer read on what is under them,
 * they keep the ink the layout paired with that field when it still reads, or else take the new
 * theme's role that reads best on it (WCAG AA: 4.5:1, 3:1 for large text). Nothing the move left
 * alone is touched.
 */
function readable(
  given: readonly SlideElement[],
  els: SlideElement[],
  i: number,
  theme: Theme,
  laidOut = false,
): SlideElement {
  const e = els[i] as SlideElement & {
    style?: Record<string, unknown>;
    textStyle?: Record<string, unknown>;
    doc?: unknown;
  };
  const label = e.type === "shape" && !!e.doc && !!e.textStyle;
  if (e.type !== "text" && !label) return e;
  const key = label ? "textStyle" : "style";
  // The field: a label's own shape, else the shape under the words.
  const j = label ? i : under(given, i);
  const was = j < 0 ? undefined : ((given[j] as unknown as Boxed).fill as string);
  const now = j < 0 ? theme.colors.background : ((els[j] as unknown as Boxed).fill as string);
  const style = e[key];
  const r = resolveTextStyle(style, theme, label ? "heading" : "body");
  const own = (given[i] as unknown as Record<string, { color?: string } | undefined>)[key]?.color;
  // Words a teacher put straight on the slide sit on its ground and art, which the move draws in the
  // new theme; only a layout's own words are read against the slide's ground.
  if (j < 0 && !laidOut) return e;
  const moved = was !== now || r.color !== own;
  if (!moved || !HEX.test(now)) return e;
  const need = r.fontSize >= 24 || (r.fontSize >= 18.66 && r.fontWeight >= 700) ? 3 : 4.5;
  if (contrast(r.color, now) >= need) return e;
  const c = theme.colors;
  const inks = [own, c.heading, c.ink, c.background, c.surface].filter(
    (x): x is string => typeof x === "string" && HEX.test(x),
  );
  const ink =
    inks.find((x) => contrast(x, now) >= need) ??
    inks.reduce((a, b) => (contrast(b, now) > contrast(a, now) ? b : a));
  return { ...e, [key]: { ...style, color: ink } } as SlideElement;
}
