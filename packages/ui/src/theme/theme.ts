/**
 * Theme vocabulary shared by the CSS (`globals.css`), the provider and the init script.
 *
 * Resolution rules (also implemented, character for character, in `THEME_INIT_SCRIPT`):
 * 1. An explicit theme ("light" | "dark" | "high-contrast") is applied as-is.
 * 2. "system" resolves from the OS: `prefers-contrast: more` → "high-contrast",
 *    else `prefers-color-scheme: dark` → "dark", else "light".
 * 3. The resolved value is written to `<html data-theme="…">`; `globals.css` does the rest.
 */

export const RESOLVED_THEMES = ["light", "dark", "high-contrast"] as const;
export const THEMES = [...RESOLVED_THEMES, "system"] as const;

/** A value the user can pick. "system" follows the OS. */
export type Theme = (typeof THEMES)[number];
/** What actually ends up on `<html data-theme>`. */
export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];

/** localStorage key holding the user's explicit choice. */
export const THEME_STORAGE_KEY = "tj-theme";

export const PREFERS_DARK_QUERY = "(prefers-color-scheme: dark)";
export const PREFERS_MORE_CONTRAST_QUERY = "(prefers-contrast: more)";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function isResolvedTheme(value: unknown): value is ResolvedTheme {
  return typeof value === "string" && (RESOLVED_THEMES as readonly string[]).includes(value);
}

export interface SystemPreferences {
  prefersDark: boolean;
  prefersMoreContrast: boolean;
}

/** Pure resolution: no DOM access, easy to test. */
export function resolveTheme(theme: Theme, prefs: SystemPreferences): ResolvedTheme {
  if (theme !== "system") return theme;
  if (prefs.prefersMoreContrast) return "high-contrast";
  return prefs.prefersDark ? "dark" : "light";
}

/** Read OS preferences; SSR-safe (returns light/no-contrast when there is no `window`). */
export function readSystemPreferences(): SystemPreferences {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return { prefersDark: false, prefersMoreContrast: false };
  }
  return {
    prefersDark: window.matchMedia(PREFERS_DARK_QUERY).matches,
    prefersMoreContrast: window.matchMedia(PREFERS_MORE_CONTRAST_QUERY).matches,
  };
}

/** Read the stored choice; SSR-safe and tolerant of blocked storage (private mode, iframes). */
export function readStoredTheme(storageKey: string): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(storageKey);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(storageKey: string, theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // Storage unavailable: the choice still applies for this page load.
  }
}

/** Apply a resolved theme to `<html>`. No-op during SSR. */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
}
