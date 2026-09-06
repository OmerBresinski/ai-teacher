import type { QuestionData, Theme } from "@tj/domain/documents";
import { resolveFontSize } from "./text-style";

/*
 * Measurement-free geometry of the "Why?" explanation panel on true-false and multiple-choice
 * slides (ADR 0025 §9). Moved verbatim from the editor's `layout/explanation.ts`, which
 * re-exports it and keeps the parts that take a `Measurer` (`reservedLines`, `explanationLane`,
 * `explanationLayout`). The recipes need only what is here: how much lane to leave free.
 */

/** Panel chrome, in slide points. */
export const PANEL = {
  /** Left and right padding inside the card. */
  padX: 19,
  /** Top and bottom padding inside the card. */
  padY: 14,
  /** Heading baseline block to body block. */
  gap: 7,
  /** Clearance between the lowest answer card and the top of the panel. */
  above: 14,
} as const;

/** The heading the panel carries. Kept here so the recipes and the tests agree. */
export const EXPLANATION_HEADING = "Why?";

/** Shown in the editor when the teacher has not written a reason yet. */
export const EXPLANATION_PLACEHOLDER = "Say why this is the answer.";

/** Question types that carry a "Why?" panel. */
export function hasExplanationPanel(question: QuestionData | undefined): boolean {
  return question?.type === "true-false" || question?.type === "multiple-choice";
}

export type PanelType = {
  headingSize: number;
  headingLine: number;
  bodySize: number;
  bodyLine: number;
};

/** The panel's type stops for a theme, at their full size. */
export function panelType(theme: Theme): PanelType {
  const headingSize = resolveFontSize(theme, "heading");
  const bodySize = resolveFontSize(theme, "body");
  return {
    headingSize,
    headingLine: Math.ceil(headingSize * theme.lineHeights.heading),
    bodySize,
    bodyLine: Math.ceil(bodySize * theme.lineHeights.body),
  };
}

/** Height of a panel holding `lines` lines of body copy, at full size. */
export function panelHeight(theme: Theme, lines = 1): number {
  const t = panelType(theme);
  return PANEL.padY * 2 + t.headingLine + PANEL.gap + t.bodyLine * Math.max(1, lines);
}

/**
 * What a true-false or multiple-choice recipe must leave free under its lowest
 * card: `lines` lines of body copy plus the panel's own chrome, plus the
 * clearance above it. Layouts are tested against this in all six themes.
 *
 * True or false asks for two lines, which is what a reason worth writing takes.
 * Multiple choice can only afford one: four legible cards and a two-line stem
 * already own the slide, and the panel takes whatever lane is actually left, so
 * a longer reason there steps down and says so rather than being refused.
 */
export const explanationReserve = (theme: Theme, lines = 1): number =>
  PANEL.above + panelHeight(theme, lines);

/**
 * Lines of body copy the recipe for `kind` keeps room for, and the floor every
 * later check holds the slide to. A slide that cannot give this much is what the
 * linter reports; a slide that can give more is the editor's `reservedLines`.
 */
export const RESERVED_LINES: Record<"true-false" | "multiple-choice", number> = {
  "true-false": 2,
  "multiple-choice": 1,
};
