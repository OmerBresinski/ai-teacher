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
   * How the look draws its small chrome, so two themes with the same layouts do not read alike.
   * Absent parts are the defaults: a tinted pill tag and a round dot bullet.
   */
  ornament?: ThemeOrnament;
};

export type ThemeOrnament = {
  /** The kind tag's fill: the accent tint with accent text (default), or solid accent. */
  tag?: "tint" | "solid";
  /** The kind tag's corner radius; a pill (99) by default. */
  tagRadius?: number;
  /** The bullet drawn in a list's indent. Drawn outside the text, so it never changes the measure. */
  marker?: "dot" | "star" | "dash" | "diamond" | "leaf";
};
