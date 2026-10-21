/**
 * The template code a layout group re-lays with (`@tj/slides/relayout`), once it has loaded. The
 * editor loads it lazily with the on-canvas layout controls (bundle budget), and the lesson
 * history's `settle` cannot wait for an import, so the controls module registers it here when it
 * loads. Until then a typed word still writes through to the layout's words; it re-lays from the
 * next keystroke on.
 */
import type { LayoutKit } from "./reducers/layout";

let current: LayoutKit | null = null;

export function setLayoutKit(kit: LayoutKit | null): void {
  current = kit;
}

export function layoutKit(): LayoutKit | null {
  return current;
}

/**
 * Load the template code now, if it has not loaded yet: a re-theme re-lays every adaptive layout
 * in the new theme's faces (TEACH-75 part aq), so the theme picker asks for it when it opens.
 */
export async function loadLayoutKit(): Promise<LayoutKit> {
  if (current) return current;
  const kit = await import("@tj/slides/relayout");
  current ??= kit;
  return current;
}
