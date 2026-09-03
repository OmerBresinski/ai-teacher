import { PREFERS_DARK_QUERY, PREFERS_MORE_CONTRAST_QUERY, THEME_STORAGE_KEY } from "./theme";

/**
 * Build the inline `<script>` body that applies the theme before first paint.
 *
 * Mirrors `resolveTheme()`: stored explicit value wins; otherwise `prefers-contrast: more` →
 * high-contrast, `prefers-color-scheme: dark` → dark, else light. Any failure (storage blocked,
 * no matchMedia) is swallowed so the page still renders — `globals.css` then falls back to
 * `html:not([data-theme])` + `prefers-color-scheme`.
 *
 * Usage (Vite `index.html`): `<script>${THEME_INIT_SCRIPT}</script>` as the first child of
 * `<head>`, before the stylesheet. Keep it dependency-free and ES5 so it needs no bundling.
 */
export function createThemeInitScript(storageKey: string = THEME_STORAGE_KEY): string {
  const key = JSON.stringify(storageKey);
  const dark = JSON.stringify(PREFERS_DARK_QUERY);
  const contrast = JSON.stringify(PREFERS_MORE_CONTRAST_QUERY);
  return (
    "(function(){try{" +
    `var t=window.localStorage.getItem(${key});` +
    "var m=function(q){return window.matchMedia&&window.matchMedia(q).matches};" +
    'var r=(t==="light"||t==="dark"||t==="high-contrast")?t:' +
    `(m(${contrast})?"high-contrast":m(${dark})?"dark":"light");` +
    'document.documentElement.setAttribute("data-theme",r);' +
    "}catch(e){}})();"
  );
}

/** Ready-to-inline script for the default storage key (`tj-theme`). */
export const THEME_INIT_SCRIPT: string = createThemeInitScript();
