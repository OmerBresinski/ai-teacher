import { isThemeId } from "@tj/slides";
import { HTTPException } from "hono/http-exception";

/*
 * TEACH-258: a `themeId` outside the catalogue is refused, never stored. `getTheme` would draw an
 * unknown id as the default theme without saying so, and the lesson would keep the bad id. The
 * worksheet `recipeId` check (`isRecipeId`, 422) is the precedent.
 */

export const UNKNOWN_THEME_MESSAGE = "That theme does not exist.";

/** 422 when `themeId` is present and not a catalogue id. */
export function assertKnownTheme(themeId: unknown): void {
  if (themeId === undefined) return;
  if (typeof themeId !== "string" || !isThemeId(themeId)) {
    throw new HTTPException(422, { message: UNKNOWN_THEME_MESSAGE });
  }
}

/** True when the body carries no `themeId` or a catalogue one. */
export function hasKnownOrNoTheme(document: unknown): boolean {
  if (document === null || typeof document !== "object" || !("themeId" in document)) return true;
  const themeId = (document as { themeId?: unknown }).themeId;
  return themeId === undefined || (typeof themeId === "string" && isThemeId(themeId));
}

/** The same check for a whole document body (`POST /documents`, `PUT /documents/:id`). */
export function assertKnownDocumentTheme(document: unknown): void {
  if (document !== null && typeof document === "object" && "themeId" in document) {
    assertKnownTheme((document as { themeId?: unknown }).themeId);
  }
}
