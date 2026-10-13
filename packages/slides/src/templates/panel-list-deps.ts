/**
 * panel-list's adapter (TEACH-75 part v): everything the template needs from the three modules
 * being built beside it, in one place, so the template never reaches into them directly.
 *
 * - Theme v2 tokens (TEACH-152 part b): `panelLook(theme, stage)` flattens what `v2Profile` and
 *   `v2Colors` will give. STAND-IN until part b lands: no theme on master has a v2 block, so every
 *   theme takes the fallback below (colours derived from `theme.colors`, sizes from the pilot's
 *   `theme-v2.css` at 1440 px x 2/3 = slide points).
 * - Icon library (TEACH-310 part b): `matchIcon(label)`. STAND-IN: an exact match against a few
 *   lucide glyphs the editor already draws; the library's matcher and `concept` replace it.
 * - Picture fit (TEACH-25 part b): `SHAPES`, `shapeMode`, `cropFor`, crop-only (no extension
 *   until a picture is baked). STAND-IN: a port of the pilot's `picture.js` maths for crop only.
 *
 * When those land on master, point these exports at the real modules and delete the stand-ins.
 */
import type { Theme } from "@tj/domain/documents";
import { contrastRatio } from "../look";
import { keyStageOf, MIN_FONT_SIZE, optionTones } from "../themes";
import type { SubjectBox } from "./index";

/* ------------------------------------------------------------------ */
/* Theme v2 (stand-in)                                                 */
/* ------------------------------------------------------------------ */

export type AgeKey = "early" | "primary" | "secondary";
/** EYFS and KS1 read early, KS2 primary, KS3 to post-16 secondary (ruling 212). */
export const ageOf = (stage: string | undefined): AgeKey =>
  stage === "eyfs" || stage === "ks1"
    ? "early"
    : stage === "ks2" || !stage
      ? "primary"
      : "secondary";

/** What panel-list draws with, in slide points (960 x 540). */
export type PanelLook = {
  age: AgeKey;
  deep: string;
  onDeep: string;
  wash: string;
  rule: string;
  ink: string;
  muted: string;
  /** Ink on a category disc (a numeral when there are no icons). */
  onCategory: (fill: string) => string;
  /** On a wash disc: the numeral. */
  onWash: string;
  category: readonly string[];
  displayWeight: number;
  bodyWeight: number;
  lineHeights: { title: number; name: number; body: number };
  sizes: { titlePanel: number; name: number; body: number };
  floors: { body: number; name: number };
  comfort: { body: number; name: number };
  disc: number;
  discIcon: number;
  /**
   * A row icon's back: round ("disc"), or from KS3 a rounded square ("tile"; Greg's icon option 2,
   * 14 Oct). A row of numbers keeps its disc at every age.
   */
  medalShape: "disc" | "tile";
  /**
   * What sits behind a row icon unless the layout options say otherwise: a pale soft disc at KS1
   * and KS2 (Greg's option B, 14 Oct), the solid tile from KS3 (icon option 2).
   */
  iconBack: "ring" | "soft";
  radiusPicture: number;
};

const px = (v: number) => Math.round(((v * 2) / 3) * 100) / 100;
/** The pilot's `theme-v2.css` age tokens (px at 1440). */
const PROFILE = {
  early: {
    title: 88,
    name: 54,
    body: 38,
    floor: [34, 44],
    comfort: [35, 46],
    disc: 124,
    icon: 0.8,
    w: 700,
    lh: 1.25,
    pic: 40,
  },
  primary: {
    title: 82,
    name: 46,
    body: 33,
    floor: [28, 32],
    comfort: [30, 38],
    disc: 112,
    icon: 0.75,
    w: 800,
    lh: 1.3,
    pic: 20,
  },
  secondary: {
    title: 76,
    name: 42,
    body: 31,
    floor: [28, 32],
    comfort: [29, 34],
    disc: 100,
    icon: 0.72,
    w: 800,
    lh: 1.3,
    pic: 8,
  },
} as const;

const hexRgb = (c: string) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
const mixHex = (a: string, b: string, k: number) =>
  `#${hexRgb(a)
    .map((v, i) => Math.round(v * k + (hexRgb(b)[i] ?? 0) * (1 - k)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
const best = (fill: string, inks: string[]) =>
  inks.reduce((a, b) => (contrastRatio(b, fill) > contrastRatio(a, fill) ? b : a));

/** The look for `theme` at the key stage it is read at (`atKeyStage`); none reads primary. */
export function panelLook(theme: Theme): PanelLook {
  const age = ageOf(keyStageOf(theme));
  const p = PROFILE[age];
  const c = theme.colors;
  // Fallback for a theme with no v2 block: the deep panel is the theme's heading ink (its deepest
  // text colour), or the accent on a dark theme where the ink is pale.
  const deepCandidate = c.heading ?? c.ink;
  const deep = contrastRatio(deepCandidate, c.background) >= 4.5 ? deepCandidate : c.accent;
  const inks = [c.background, c.surface, c.onAccent, c.ink];
  // Distinct hues only: a theme's accent is often one of its option tones.
  const tones = [
    ...new Set([...optionTones(theme), c.accent, c.accent2].map((x) => x.toLowerCase())),
  ];
  const wash = mixHex(c.accent, c.background, 0.12);
  // Never under master's reading floor (MIN_FONT_SIZE.body, ruling 140).
  const floorBody = Math.max(px(p.floor[0]), MIN_FONT_SIZE.body);
  const floorName = Math.max(px(p.floor[1]), MIN_FONT_SIZE.body);
  return {
    age,
    deep,
    onDeep: best(deep, inks),
    wash,
    rule: c.line,
    ink: c.heading ?? c.ink,
    muted: c.muted,
    onCategory: (fill) => best(fill, inks),
    onWash: best(wash, [deep, c.accent, c.ink]),
    category: tones,
    displayWeight: p.w,
    bodyWeight: 400,
    lineHeights: { title: 1, name: 1.08, body: p.lh },
    sizes: { titlePanel: px(p.title), name: px(p.name), body: px(p.body) },
    floors: { body: floorBody, name: floorName },
    comfort: {
      body: Math.max(px(p.comfort[0]), floorBody),
      name: Math.max(px(p.comfort[1]), floorName),
    },
    disc: px(p.disc),
    discIcon: p.icon,
    medalShape: age === "secondary" ? "tile" : "disc",
    iconBack: age === "secondary" ? "ring" : "soft",
    radiusPicture: px(p.pic),
  };
}

/* ------------------------------------------------------------------ */
/* Icon library (stand-in)                                             */
/* ------------------------------------------------------------------ */

/** Lucide glyphs the editor draws (IconView), by the concept label they stand for. */
const STAND_IN_ICONS: Record<string, string> = {
  apple: "apple",
  fruit: "apple",
  fish: "fish",
  heart: "heart",
  leaf: "leaf",
  plant: "sprout",
  seed: "sprout",
  water: "droplet",
  drop: "droplet",
  sun: "sun",
  moon: "moon",
  fire: "flame",
  flame: "flame",
  snow: "snowflake",
  ice: "snowflake",
  mountain: "mountain",
  bird: "bird",
  dog: "dog",
  cat: "cat",
  rabbit: "rabbit",
  bug: "bug",
  insect: "bug",
  brain: "brain",
  eye: "eye",
  ear: "ear",
  hand: "hand",
  earth: "earth",
  cloud: "cloud",
  rain: "cloud-rain",
  star: "star",
  tree: "tree-pine",
  magnet: "magnet",
  thermometer: "thermometer",
};

/** Lower case, trimmed, single spaces: the library matcher's rules. */
export const normalise = (label: string): string => label.toLowerCase().trim().replace(/\s+/g, " ");

/** The library concept for an icon label (exact, or with a trailing plural folded), or null. */
export function matchIcon(label: string): string | null {
  const k = normalise(label);
  for (const key of [k, k.replace(/s$/, ""), k.replace(/es$/, "")])
    if (Object.hasOwn(STAND_IN_ICONS, key)) return STAND_IN_ICONS[key] ?? null;
  return null;
}

/* ------------------------------------------------------------------ */
/* Picture fit (stand-in, crop only)                                   */
/* ------------------------------------------------------------------ */

export type FracRect = { x: number; y: number; w: number; h: number };
export type PictureFacts = { width: number; height: number; subject?: FracRect };
export type ShapeName = "16:9" | "4:3" | "1:1" | "3:4";
export const SHAPES: readonly (readonly [ShapeName, number])[] = [
  ["16:9", 16 / 9],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["3:4", 3 / 4],
];
export const ZOOM_FILL = 0.72;
export const RES_FLOOR = 0.6;
const MARGIN = 0.025;

/** A product figure's facts: its aspect at a nominal 1000 px tall, the union of its subjects. */
export function factsOf(aspect: number, subjects?: SubjectBox[]): PictureFacts {
  const facts: PictureFacts = { width: Math.round(aspect * 1000), height: 1000 };
  if (!subjects?.length) return facts;
  const x0 = Math.min(...subjects.map((b) => b.x));
  const y0 = Math.min(...subjects.map((b) => b.y));
  const x1 = Math.max(...subjects.map((b) => b.x + b.w));
  const y1 = Math.max(...subjects.map((b) => b.y + b.h));
  return { ...facts, subject: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

const maxCropW = (f: PictureFacts, r: number) => Math.min(f.width, f.height * r);
function needPx(f: PictureFacts) {
  const s = f.subject;
  if (!s) return { w: 0.7 * f.width, h: 0.7 * f.height };
  const x0 = Math.max(0, s.x - MARGIN);
  const x1 = Math.min(1, s.x + s.w + MARGIN);
  const y0 = Math.max(0, s.y - MARGIN);
  const y1 = Math.min(1, s.y + s.h + MARGIN);
  return { w: (x1 - x0) * f.width, h: (y1 - y0) * f.height };
}

/** How standard shape `r` can show the picture: "crop" inside it, or null (never extends here). */
export function shapeMode(f: PictureFacts, r: number): "crop" | "extend" | null {
  const n = needPx(f);
  return Math.max(n.w, n.h * r) <= maxCropW(f, r) + 0.5 ? "crop" : null;
}

/** The crop (fractions of the image) for a box of the chosen shape, zoomed to the subject. */
export function cropFor(f: PictureFacts, box: { w: number; h: number }): FracRect {
  const r = box.w / box.h;
  const s = f.subject;
  const mc = maxCropW(f, r);
  const n = needPx(f);
  // Unzoomed: the largest in-image crop of the box's shape.
  let cw = mc;
  if (s && s.w <= 0.9) {
    const want = Math.max(
      (s.w * f.width) / ZOOM_FILL,
      (s.h * f.height * r) / ZOOM_FILL,
      n.w,
      n.h * r,
    );
    // The box's points stand in for its source pixels at 1440 (x 1.5).
    cw = Math.max(Math.min(want, mc), Math.min(mc, RES_FLOOR * box.w * 1.5));
  }
  cw = Math.min(cw, mc);
  const ch = cw / r;
  const fx = s ? s.x + s.w / 2 : 0.5;
  const fy = s ? s.y + s.h / 2 : 0.5;
  const place = (c: number, size: number, full: number) =>
    Math.min(Math.max(c - size / 2, 0), full - size);
  const x0 = place(fx * f.width, cw, f.width);
  const y0 = place(fy * f.height, ch, f.height);
  const q = (v: number) => Math.round(v * 10000) / 10000;
  return { x: q(x0 / f.width), y: q(y0 / f.height), w: q(cw / f.width), h: q(ch / f.height) };
}
