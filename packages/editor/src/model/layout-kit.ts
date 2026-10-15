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
