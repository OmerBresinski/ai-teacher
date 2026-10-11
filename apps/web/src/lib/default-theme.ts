import { deriveAgeBand, fallbackThemeFor, liveThemeId } from "@tj/domain/documents";

/*
 * The theme a new lesson starts in (UX rulings 116, 202): no theme question before generation.
 * The teacher's own last choice always wins and is sent with the brief; with none, nothing is sent
 * and the planner picks the theme for the topic and age (falling back to Splash up to Year 6,
 * Studio from Year 7). A remembered retired theme (Chalk & Cream) is sent as the one it renders in.
 */

/** The theme the brief sends: the teacher's remembered choice, or none for the planner to pick. */
export function startingTheme(remembered: string | undefined): string | undefined {
  return remembered ? liveThemeId(remembered) : undefined;
}

/** The theme shown before the planner has run: the key stage fallback for the year group. */
export function previewTheme(yearGroup: string | undefined): string {
  return fallbackThemeFor(deriveAgeBand(yearGroup));
}
