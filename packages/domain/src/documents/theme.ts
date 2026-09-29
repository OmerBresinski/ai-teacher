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
export const DEFAULT_THEME_ID = "chalk";

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
