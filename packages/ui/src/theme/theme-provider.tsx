import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  applyResolvedTheme,
  isTheme,
  PREFERS_DARK_QUERY,
  PREFERS_MORE_CONTRAST_QUERY,
  type ResolvedTheme,
  readStoredTheme,
  readSystemPreferences,
  resolveTheme,
  THEME_STORAGE_KEY,
  type Theme,
  writeStoredTheme,
} from "./theme";

export interface ThemeContextValue {
  /** The user's choice ("system" means: follow the OS). */
  theme: Theme;
  /** What is currently applied to `<html data-theme>`. */
  resolvedTheme: ResolvedTheme;
  /** Persist and apply a new choice. */
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
  /** Used when nothing is stored yet. Default `"system"`. */
  defaultTheme?: Theme;
  /** localStorage key. Default `"tj-theme"`; must match `createThemeInitScript(storageKey)`. */
  storageKey?: string;
}

/**
 * Owns the `data-theme` attribute on `<html>`.
 *
 * - Stored value (localStorage) wins over `defaultTheme`; both win over the OS unless "system".
 * - "system" follows `prefers-contrast: more` (→ high-contrast) then `prefers-color-scheme`
 *   and re-resolves live when the OS setting changes.
 * - "high-contrast" is otherwise explicit only.
 * - Changes made in another tab (storage event) are mirrored.
 * - SSR-safe: nothing touches `window`/`document` during render.
 */
export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = THEME_STORAGE_KEY,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme(storageKey) ?? defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(theme, readSystemPreferences()),
  );

  // Apply + (when "system") track OS changes.
  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(theme, readSystemPreferences());
      setResolvedTheme(next);
      applyResolvedTheme(next);
    };
    apply();

    if (theme !== "system" || typeof window === "undefined") return;
    if (typeof window.matchMedia !== "function") return;

    const queries = [PREFERS_DARK_QUERY, PREFERS_MORE_CONTRAST_QUERY].map((q) =>
      window.matchMedia(q),
    );
    for (const mq of queries) mq.addEventListener("change", apply);
    return () => {
      for (const mq of queries) mq.removeEventListener("change", apply);
    };
  }, [theme]);

  // Mirror changes from other tabs.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      if (isTheme(event.newValue)) setThemeState(event.newValue);
      else if (event.newValue === null) setThemeState(defaultTheme);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey, defaultTheme]);

  const setTheme = useCallback(
    (next: Theme) => {
      writeStoredTheme(storageKey, next);
      setThemeState(next);
    },
    [storageKey],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error("useTheme() must be used inside <ThemeProvider> (from @tj/ui).");
  }
  return ctx;
}
