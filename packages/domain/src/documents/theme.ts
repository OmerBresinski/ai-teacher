import type { TextPreset } from "./slide";

/*
 * Theme types (ADR 0021). The catalogue (`THEMES`, `getTheme`) and the fonts it names live in
 * `@tj/editor`; a document only carries a `themeId`. Behavioural reference: TeachDeck
 * `lib/model/types.ts:317-354`.
 */

/**
 * The theme a lesson gets when nobody chose one. Declared here as well as in the `@tj/editor`
 * catalogue so the API (`POST /lessons`, ADR 0024 §6) can set it without importing the editor;
 * `@tj/editor` re-exports this value, so the two cannot drift.
 */
export const DEFAULT_THEME_ID = "splash";

/**
 * Retired theme ids and the theme a lesson stored with one renders in (UX ruling 202: Chalk &
 * Cream is retired, its lessons render as Splash). Never offered, never accepted on a new write.
 */
export const RETIRED_THEMES: Readonly<Record<string, string>> = { chalk: "splash" };

/** `id` with a retired id swapped for the theme it now renders in. */
export const liveThemeId = (id: string): string => RETIRED_THEMES[id] ?? id;

/**
 * The theme a lesson gets when neither the teacher nor the planner chose one (UX ruling 202):
 * Splash up to Key Stage 2 (Reception to Year 6), Studio from Key Stage 3. No band: the default.
 */
export function fallbackThemeFor(ageBand: string | undefined | null): string {
  if (!ageBand || ageBand === "eyfs" || ageBand === "ks1" || ageBand === "ks2")
    return DEFAULT_THEME_ID;
  return "studio";
}

export type ThemeTag =
  | "early-learners"
  | "low-stimulation"
  | "dyslexia"
  | "low-vision"
  | "adhd"
  | "dark";

export type Theme = {
  id: string;
  name: string;
  /** Who it suits, for the picker. */
  suits: string;
  /** Accessibility / audience filter chips in the picker. */
  tags: ThemeTag[];
  dark?: boolean;
  colors: {
    background: string;
    surface: string;
    ink: string;
    /**
     * Titles and headings (the title, subtitle and heading presets) when the text sets no colour
     * of its own; `ink` when absent. The playful themes set it to their accent, the way a
     * children's deck colours its headings. AA on the ground and the cards like `ink`.
     */
    heading?: string;
    muted: string;
    accent: string;
    accent2: string;
    onAccent: string;
    /**
     * The fill of the look's panels (the key-idea card, the key-term panel, the worked card) when
     * it is not the accent tint: a playful theme's white card on a coloured ground, or its sticky
     * note. AA for `ink` and `accent` like the ground.
     */
    panel?: string;
    /** Hairline / rule colour. */
    line: string;
    /** Correct / incorrect for question reveals. */
    correct: string;
    incorrect: string;
  };
  fonts: {
    /** CSS font-family stacks; the families are registered by the editor package. */
    title: string;
    body: string;
  };
  /** Font sizes in slide points for each preset (960x540 space). */
  sizes: Record<TextPreset, number>;
  lineHeights: Record<TextPreset, number>;
  weights: { title: number; heading: number; body: number };
  titleTracking: string;
  radius: number;
  /**
   * Optional background art: a CSS `background` value (gradients or an inline SVG `url()`, with
   * position, size and repeat). PPTX leaves theme art out and keeps the flat ground.
   */
  backgroundImage?: string;
  /**
   * Art per slide role (UX ruling 107): the title slide's fullest art, a lighter `content` variant
   * kept to the margins, and a `picture` motif for slides with a photo or diagram, drawn for a
   * picture on the left and mirrored for one on the right. A role left out is the plain ground.
   * When present it replaces `backgroundImage`, which stays the art for themes without variants.
   * Resolved by `slideBackground` in `@tj/slides`.
   */
  backgrounds?: Partial<Record<ThemeArtRole, ThemeArtLayer[]>>;
  /**
   * How the look draws its small chrome, so two themes with the same layouts do not read alike.
   * Absent parts are the defaults: a tinted pill tag and a round dot bullet.
   */
  ornament?: ThemeOrnament;
  /**
   * The theme v2 block (UX rulings 211, 212): the extra colour roles, accent families and age
   * profiles the v2 layouts read. Absent on the v1 themes; "is v2" is `theme.v2 !== undefined`.
   * Layout code reads it through `v2Profile` and `v2Colors` in `@tj/slides`, never inline.
   */
  v2?: ThemeV2;
};

/** The three v2 age profiles: EYFS and KS1 read early, KS2 primary, KS3 to post-16 secondary. */
export type AgeProfileKey = "early" | "primary" | "secondary";

/**
 * One accent family: a deck picks one and everything else stays neutral. `soft` is the connector
 * band and the first split field's base, `wash` the number discs, `deep` the title panel and the
 * deep heading, `shadow` the medal shadow's hue.
 */
export type ThemeV2Accent = {
  accent: string;
  soft: string;
  wash: string;
  deep: string;
  shadow: string;
  /** The icon library's colour slots that follow the accent (T6). Primary is `accent`, tint `wash`. */
  icon: { primaryDark: string; secondary: string; secondaryDark: string };
};

/** Neutrals an age profile may retune (the early profile's warmer paper and deeper ink). */
export type ThemeV2Neutrals = {
  background: string;
  ink: string;
  muted: string;
  rule: string;
  sand: string;
};

/** Sizes in slide points (960x540, like `Theme.sizes`); ratios are unitless. */
export type ThemeV2AgeProfile = {
  /** Font keys (`FontKey` in `@tj/slides`). Each theme picks its own per age (ruling 212). */
  fonts: { display: string; body: string; quote: string };
  quoteStyle: "italic" | "normal";
  displayWeight: number;
  bodyWeight: number;
  /** CSS word-spacing for display text: secondary's Schibsted is narrow at display sizes. */
  wordSpace: string;
  tracking: { title: string; name: string };
  lineHeights: { title: number; body: number };
  sizes: {
    title: number;
    titlePanel: number;
    name: number;
    body: number;
    quote: number;
    badge: number;
  };
  /** Fit never goes below these. */
  floors: { body: number; name: number; label: number };
  /** "Comfortable" needs body and names at or above these. */
  comfort: { body: number; name: number };
  /** The white icon medal at 2-3 items, and the size under which it stops reading as the hero. */
  medal: number;
  medalMin: number;
  /** A row's icon disc, the icon's share of it, and the ink number badge. */
  disc: number;
  discIcon: number;
  badge: number;
  /** The category colour ring round an icon's white face. */
  iconRing: number;
  radius: { picture: number; bubble: number; tail: number; card: number };
  /** Connector band width and wave depth, as ratios of the medal. */
  band: number;
  wave: number;
  strokes: { dot: number; line: number };
  /** Neutrals this age retunes; the rest come from the theme. */
  colors?: Partial<ThemeV2Neutrals>;
};

export type ThemeV2 = {
  colors: {
    onDeep: string;
    sand: string;
    rule: string;
    /** Six colours only ever behind icons (rings round a white face), never on text. */
    category: readonly [string, string, string, string, string, string];
    /** The road motif's warm grey, never the accent. */
    road: string;
  };
  /** Accent families by name; `defaultAccent` is the one a deck takes when it names none. */
  accents: Record<string, ThemeV2Accent>;
  defaultAccent: string;
  /** The age profiles this theme serves (ruling 212); a stage outside them reads the nearest. */
  supports: readonly AgeProfileKey[];
  ages: Partial<Record<AgeProfileKey, ThemeV2AgeProfile>>;
};

export type ThemeArtRole = "title" | "content" | "picture";

/**
 * One piece of theme art, drawn once at its box in slide points (960x540). The box is what the
 * no-overlap check reads, so a layer's image must stay inside it.
 */
export type ThemeArtLayer = {
  /** A CSS image: an inline SVG `url()` or a gradient. */
  image: string;
  /** The same art drawn left-right mirrored, for the picture variant's other side. */
  flipped?: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ThemeOrnament = {
  /** The kind tag's fill: the accent tint with accent text (default), or solid accent. */
  tag?: "tint" | "solid";
  /** The kind tag's corner radius; a pill (99) by default. */
  tagRadius?: number;
  /** The bullet drawn in a list's indent. Drawn outside the text, so it never changes the measure. */
  marker?: "dot" | "star" | "dash" | "diamond" | "leaf";
};
