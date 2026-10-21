import type { ThemeV2, ThemeV2AgeProfile } from "@tj/domain/documents";
import type { FontKey } from "./fonts";

/*
 * Theme v2's values (TEACH-152 part b; UX rulings 211, 212): the golds (`free/cards/F2-three`,
 * `F2-five`) as the pilot wrote them in `northstars/theme-v2.css` and `THEME.md`. The pilot works
 * in px on a 1440 slide; themes are in slide points on a 960 slide, so every size goes through
 * `pxToPt` once, here. Ratios (band, wave, the icon's share of a disc) stay as they are.
 */

/** A pilot px size on the 1440 slide as slide points on the 960 slide (x2/3), to one decimal. */
export const pxToPt = (px: number): number => Math.round(((px * 2) / 3) * 10) / 10;

type Profile = Omit<ThemeV2AgeProfile, "fonts"> & {
  fonts: { display: FontKey; body: FontKey; quote: FontKey };
};

/** Each size of a profile written in pilot px, converted together. */
function profile(p: {
  fonts: Profile["fonts"];
  quoteStyle: Profile["quoteStyle"];
  displayWeight: number;
  wordSpace: string;
  tracking: Profile["tracking"];
  lineHeights: Profile["lineHeights"];
  /** px: title, titlePanel, name, body, quote, badge label */
  sizes: [number, number, number, number, number, number];
  /** px: body, name, label */
  floors: [number, number, number];
  /** px: body, name */
  comfort: [number, number];
  /** px: medal, medalMin, disc, badge, iconRing */
  shapes: [number, number, number, number, number];
  discIcon: number;
  /** px: picture, bubble, tail */
  radius: [number, number, number];
  band: number;
  wave: number;
  /** px: dot, line */
  strokes: [number, number];
  colors?: Profile["colors"];
}): Profile {
  const [title, titlePanel, name, body, quote, badgeLabel] = p.sizes.map(pxToPt) as Tuple6;
  const [fBody, fName, fLabel] = p.floors.map(pxToPt) as Tuple3;
  const [cBody, cName] = p.comfort.map(pxToPt) as Tuple2;
  const [medal, medalMin, disc, badge, iconRing] = p.shapes.map(pxToPt) as Tuple5;
  const [picture, bubble, tail] = p.radius.map(pxToPt) as Tuple3;
  const [dot, line] = p.strokes.map(pxToPt) as Tuple2;
  return {
    fonts: p.fonts,
    quoteStyle: p.quoteStyle,
    displayWeight: p.displayWeight,
    bodyWeight: 400,
    wordSpace: p.wordSpace,
    tracking: p.tracking,
    lineHeights: p.lineHeights,
    sizes: { title, titlePanel, name, body, quote, badge: badgeLabel },
    floors: { body: fBody, name: fName, label: fLabel },
    comfort: { body: cBody, name: cName },
    medal,
    medalMin,
    disc,
    discIcon: p.discIcon,
    badge,
    iconRing,
    // The golds have no card; a card is rounded like the pictures beside it.
    radius: { picture, bubble, tail, card: picture },
    band: p.band,
    wave: p.wave,
    strokes: { dot, line },
    ...(p.colors ? { colors: p.colors } : {}),
  };
}
type Tuple2 = [number, number];
type Tuple3 = [number, number, number];
type Tuple5 = [number, number, number, number, number];
type Tuple6 = [number, number, number, number, number, number];

/** KS2: the golds' own values (`:root` in theme-v2.css). */
const PRIMARY = profile({
  fonts: { display: "lexend", body: "lexend", quote: "sourceSerif" },
  quoteStyle: "italic",
  displayWeight: 800,
  wordSpace: "normal",
  tracking: { title: "-0.03em", name: "-0.02em" },
  lineHeights: { title: 1, body: 1.3 },
  sizes: [72, 82, 46, 33, 32, 26],
  floors: [28, 32, 22],
  comfort: [30, 38],
  shapes: [268, 188, 112, 54, 7],
  discIcon: 0.75,
  radius: [20, 26, 4],
  band: 0.127,
  wave: 0.26,
  strokes: [5, 8],
});

/**
 * EYFS and KS1: largest type, roundest, warmest. Andika's infant a and g throughout, the quote
 * voice included (infant forms beat italics for early readers); early floors sit above primary's
 * own sizes, so early text is never smaller.
 */
const EARLY = profile({
  fonts: { display: "andika", body: "andika", quote: "andika" },
  quoteStyle: "normal",
  displayWeight: 700,
  wordSpace: "normal",
  tracking: { title: "0em", name: "0em" },
  lineHeights: { title: 1, body: 1.25 },
  sizes: [80, 88, 54, 38, 37, 30],
  floors: [34, 44, 26],
  comfort: [35, 46],
  shapes: [288, 202, 124, 62, 9],
  discIcon: 0.8,
  radius: [40, 30, 8],
  band: 0.16,
  wave: 0.3,
  strokes: [7, 11],
  colors: {
    background: "#FFF7EC",
    ink: "#2A1A24",
    muted: "#3F3040",
    rule: "#F2E4CF",
    sand: "#F7E8D2",
  },
});

/** KS3 to post-16: crisper and more restrained; Schibsted display with a wider word space. */
const SECONDARY = profile({
  fonts: { display: "schibsted", body: "lexend", quote: "sourceSerif" },
  quoteStyle: "italic",
  displayWeight: 800,
  wordSpace: "0.12em",
  tracking: { title: "-0.01em", name: "-0.005em" },
  lineHeights: { title: 1, body: 1.3 },
  sizes: [68, 76, 42, 31, 30, 24],
  floors: [28, 32, 22],
  comfort: [29, 34],
  shapes: [240, 168, 100, 48, 5],
  discIcon: 0.72,
  radius: [8, 12, 2],
  band: 0.1,
  wave: 0.2,
  strokes: [4, 6],
  colors: { muted: "#5A5060" },
});

/** The v2 age profiles, also the geometry a v1 theme borrows when a v2 layout reads it. */
export const V2_AGE_PROFILES = { early: EARLY, primary: PRIMARY, secondary: SECONDARY } as const;

/**
 * The paper theme's v2 block. Accent families from theme-v2.css; each family's icon slots
 * (`icons/tokens.css`): the dark is the accent mixed 70% with black in OKLab, as the pilot slide
 * computes it, and the partner hue is blue for the warm accents, amber for the cool ones.
 */
export const PAPER_V2: ThemeV2 = {
  colors: {
    onDeep: "#FFF6E8",
    sand: "#F3EADB",
    rule: "#EFE6D8",
    // The gold's amber (#E9A23B) is 2.1:1 on paper, under the 3:1 a ring needs (WCAG 1.4.11):
    // darkened in OKLab lightness only, to the first value at 3:1 on both papers.
    category: ["#3C9A4B", "#C68100", "#E2614B", "#3F95D0", "#8A66C2", "#2A9D8F"],
    road: "#DCD3CC",
  },
  accents: {
    red: {
      accent: "#D7263D",
      soft: "#F6C9C2",
      wash: "#FCE3E0",
      deep: "#5A1530",
      shadow: "#7A1F3D",
      icon: { primaryDark: "#851322", secondary: "#2F7FD1", secondaryDark: "#1F5C9E" },
    },
    green: {
      accent: "#2C8A43",
      soft: "#CDE6C8",
      wash: "#E6F2E1",
      deep: "#1F4A38",
      shadow: "#1F4A38",
      icon: { primaryDark: "#175326", secondary: "#E8A33A", secondaryDark: "#B87A1E" },
    },
    blue: {
      accent: "#1F6FB8",
      soft: "#C9DDF0",
      wash: "#E3EEF8",
      deep: "#173A5E",
      shadow: "#173A5E",
      icon: { primaryDark: "#0F4271", secondary: "#E8A33A", secondaryDark: "#B87A1E" },
    },
    orange: {
      accent: "#D2561C",
      soft: "#F6D2BC",
      wash: "#FBE7DA",
      deep: "#5B2A14",
      shadow: "#5B2A14",
      icon: { primaryDark: "#81320D", secondary: "#2F7FD1", secondaryDark: "#1F5C9E" },
    },
    plum: {
      accent: "#7B3FA0",
      soft: "#E0CDEB",
      wash: "#F1E8F6",
      deep: "#3A1D4E",
      shadow: "#3A1D4E",
      icon: { primaryDark: "#4A2361", secondary: "#E8A33A", secondaryDark: "#B87A1E" },
    },
  },
  defaultAccent: "red",
  supports: ["early", "primary", "secondary"],
  ages: V2_AGE_PROFILES,
};
