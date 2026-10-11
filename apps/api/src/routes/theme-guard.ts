import { RETIRED_THEMES } from "@tj/domain/documents";
import { isThemeId, liveThemeId } from "@tj/slides";
import { HTTPException } from "hono/http-exception";

/*
 * TEACH-258: a `themeId` outside the catalogue is refused, never stored. `getTheme` would draw an
 * unknown id as the default theme without saying so, and the lesson would keep the bad id. The
 * worksheet `recipeId` check (`isRecipeId`, 422) is the precedent.
 */

export const UNKNOWN_THEME_MESSAGE = "That theme does not exist.";

/** A catalogue id, or a retired one an older client may still send (UX ruling 202: chalk). */
const isKnownTheme = (id: string): boolean => isThemeId(id) || Object.hasOwn(RETIRED_THEMES, id);

/**
 * 422 when `themeId` is present and not a catalogue id. Returns the id to store: a retired id
 * (an older client's `chalk`) is accepted and stored as the theme it renders in (`splash`).
 */
export function assertKnownTheme(themeId: unknown): string | undefined {
  if (themeId === undefined) return undefined;
  if (typeof themeId !== "string" || !isKnownTheme(themeId)) {
    throw new HTTPException(422, { message: UNKNOWN_THEME_MESSAGE });
  }
  return liveThemeId(themeId);
}

/** `document` with a retired `themeId` swapped for the theme it renders in; otherwise as given. */
export function withLiveTheme<T>(document: T): T {
  if (document === null || typeof document !== "object" || !("themeId" in document))
    return document;
  const themeId = (document as { themeId?: unknown }).themeId;
  if (typeof themeId !== "string" || liveThemeId(themeId) === themeId) return document;
  return { ...document, themeId: liveThemeId(themeId) };
}

/** True when the body carries no `themeId` or a catalogue one. */
export function hasKnownOrNoTheme(document: unknown): boolean {
  if (document === null || typeof document !== "object" || !("themeId" in document)) return true;
  const themeId = (document as { themeId?: unknown }).themeId;
  return themeId === undefined || (typeof themeId === "string" && isKnownTheme(themeId));
}

/** The same check for a whole document body (`POST /documents`, `PUT /documents/:id`). */
export function assertKnownDocumentTheme(document: unknown): void {
  if (document !== null && typeof document === "object" && "themeId" in document) {
    assertKnownTheme((document as { themeId?: unknown }).themeId);
  }
}
