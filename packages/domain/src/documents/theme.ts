import type { TextPreset } from "./slide";

/*
 * Theme types (ADR 0021). The catalogue (`THEMES`, `getTheme`, `DEFAULT_THEME_ID`) and the
 * fonts it names live in `@tj/editor`; a document only carries a `themeId`. Behavioural
 * reference: TeachDeck `lib/model/types.ts:317-354`.
 */

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
    muted: string;
    accent: string;
    accent2: string;
    onAccent: string;
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
  /** Optional background image or gradient. */
  backgroundImage?: string;
};
