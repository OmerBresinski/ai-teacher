import type {
  AgeProfileKey,
  Theme,
  ThemeV2,
  ThemeV2Accent,
  ThemeV2AgeProfile,
} from "@tj/domain/documents";
import { FONT_STACKS, type FontKey } from "./fonts";
import { PAPER_V2, V2_AGE_PROFILES } from "./theme-v2-paper";
import { keyStageOf } from "./themes";

/*
 * The one v2 accessor (TEACH-152 part b; UX rulings 211, 212). A v2 layout asks `v2Profile(theme)`
 * for its type, floors, shapes and radii and `v2Colors(theme, accent)` for every colour; it never
 * reads `theme.v2` itself or hard-codes a value. A v1 theme answers too, by derivation: its own
 * colours and fonts on the v2 geometry, so a v2 layout renders on any theme.
 */

const ORDER: readonly AgeProfileKey[] = ["early", "primary", "secondary"];

/**
 * The age profile a key stage or age band reads: EYFS and KS1 early, KS2 primary, KS3 to
 * post-16 secondary. No stage (a catalogue theme) reads primary, the golds' own values.
 */
export function ageProfileOf(stage: string | undefined | null): AgeProfileKey {
  switch (typeof stage === "string" ? stage.toLowerCase() : "") {
    case "eyfs":
    case "ks1":
      return "early";
    case "ks3":
    case "ks4":
    case "ks5":
    case "post16":
      return "secondary";
    default:
      return "primary";
  }
}

/** `want` if supported, else the nearest supported profile; a tie goes to the younger (larger type). */
function nearest(want: AgeProfileKey, supports: readonly AgeProfileKey[]): AgeProfileKey {
  if (supports.length === 0 || supports.includes(want)) return want;
  const at = ORDER.indexOf(want);
  const [best] = [...supports].sort(
    (a, b) =>
      Math.abs(ORDER.indexOf(a) - at) - Math.abs(ORDER.indexOf(b) - at) ||
      ORDER.indexOf(a) - ORDER.indexOf(b),
  );
  return best ?? want;
}

/** A resolved age profile: font keys are CSS stacks, ready for a text element. */
export type V2Profile = Omit<ThemeV2AgeProfile, "fonts" | "colors"> & {
  age: AgeProfileKey;
  fonts: { display: string; body: string; quote: string };
};

const stackOf = (key: string): string =>
  Object.hasOwn(FONT_STACKS, key) ? FONT_STACKS[key as FontKey] : key;

function rawProfile(theme: Theme): { age: AgeProfileKey; p: ThemeV2AgeProfile } {
  const want = ageProfileOf(keyStageOf(theme));
  const v2 = theme.v2;
  if (!v2) return { age: want, p: V2_AGE_PROFILES[want] };
  const supported = ORDER.filter((a) => v2.supports.includes(a) && v2.ages[a]);
  const age = nearest(want, supported);
  return { age, p: v2.ages[age] ?? V2_AGE_PROFILES[age] };
}

/**
 * The theme's v2 age profile at its key stage (`atKeyStage`, `getTheme(id, band)`), or the
 * nearest one it supports. A v1 theme gets the v2 geometry at that age with its own fonts,
 * weights and tracking.
 */
export function v2Profile(theme: Theme): V2Profile {
  const { age, p } = rawProfile(theme);
  const { fonts, colors: _neutrals, ...rest } = p;
  if (theme.v2) {
    return {
      ...rest,
      age,
      fonts: {
        display: stackOf(fonts.display),
        body: stackOf(fonts.body),
        quote: stackOf(fonts.quote),
      },
    };
  }
  return {
    ...rest,
    age,
    fonts: { display: theme.fonts.title, body: theme.fonts.body, quote: theme.fonts.body },
    quoteStyle: "normal",
    displayWeight: theme.weights.title,
    bodyWeight: theme.weights.body,
    wordSpace: "normal",
    tracking: { title: theme.titleTracking, name: theme.titleTracking },
  };
}

/** Every colour a v2 layout paints with, at the theme's age and one accent family. */
export type V2Colors = {
  background: string;
  surface: string;
  ink: string;
  muted: string;
  /** Titles and names: the accent family's deep on a v2 theme. */
  heading: string;
  accent: string;
  soft: string;
  wash: string;
  deep: string;
  onDeep: string;
  /** The medal shadow's hue. */
  shadow: string;
  sand: string;
  rule: string;
  /** Split fields in order: the accent's soft tint on paper, sand, then a breath of ink. */
  fields: readonly [string, string, string];
  /** Only ever behind icons, as a ring round a white face; never on text. */
  category: readonly string[];
  connector: { band: string; dot: string };
  road: string;
  /** The icon library's colour slots (`icons/tokens.css`). */
  icon: {
    primary: string;
    primaryDark: string;
    secondary: string;
    secondaryDark: string;
    tint: string;
    ink: string;
    stroke: string;
  };
};

/** `a` over `b` at `t` (0..1), mixed in sRGB like CSS `color-mix(in srgb, a t, b)`. */
function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) =>
    Math.round(ch(a, i) * t + ch(b, i) * (1 - t))
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${out.join("")}`.toUpperCase();
}

/** A v1 theme's stand-in for the v2 block: its accent as the one family, the gold's categories. */
function derivedV2(theme: Theme): ThemeV2 {
  const c = theme.colors;
  const deep = theme.dark ? c.surface : c.ink;
  const family: ThemeV2Accent = {
    accent: c.accent,
    soft: mix(c.accent, c.background, 0.3),
    wash: mix(c.accent, c.background, 0.12),
    deep,
    shadow: deep,
    icon: {
      primaryDark: mix(c.accent, "#000000", 0.7),
      secondary: c.accent2,
      secondaryDark: mix(c.accent2, "#000000", 0.7),
    },
  };
  return {
    colors: {
      onDeep: theme.dark ? c.ink : c.background,
      sand: mix(c.ink, c.background, 0.06),
      rule: c.line,
      category: PAPER_V2.colors.category,
      road: mix(c.ink, c.background, 0.18),
    },
    accents: { theme: family },
    defaultAccent: "theme",
    supports: ORDER,
    ages: {},
  };
}

/**
 * The theme's v2 colours at its age (an age profile may retune the neutrals) in accent family
 * `accent`; a family the theme does not have, or none, is its default.
 */
export function v2Colors(theme: Theme, accent?: string): V2Colors {
  const v2 = theme.v2 ?? derivedV2(theme);
  const fam =
    (accent && Object.hasOwn(v2.accents, accent) ? v2.accents[accent] : undefined) ??
    (v2.accents[v2.defaultAccent] as ThemeV2Accent);
  const n = (theme.v2 ? rawProfile(theme).p.colors : undefined) ?? {};
  const background = n.background ?? theme.colors.background;
  const ink = n.ink ?? theme.colors.ink;
  const sand = n.sand ?? v2.colors.sand;
  return {
    background,
    surface: theme.colors.surface,
    ink,
    muted: n.muted ?? theme.colors.muted,
    // Ink headings with one accent word (ruling 259); the deep tone stays for panels and markers.
    heading: theme.v2 ? ink : (theme.colors.heading ?? ink),
    accent: fam.accent,
    soft: fam.soft,
    wash: fam.wash,
    deep: fam.deep,
    onDeep: v2.colors.onDeep,
    shadow: fam.shadow,
    sand,
    rule: n.rule ?? v2.colors.rule,
    fields: [mix(fam.soft, background, 0.72), sand, mix(ink, background, 0.07)],
    category: v2.colors.category,
    connector: { band: fam.soft, dot: fam.accent },
    road: v2.colors.road,
    icon: {
      primary: fam.accent,
      primaryDark: fam.icon.primaryDark,
      secondary: fam.icon.secondary,
      secondaryDark: fam.icon.secondaryDark,
      tint: fam.wash,
      ink,
      stroke: ink,
    },
  };
}
