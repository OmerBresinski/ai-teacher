/**
 * Workspace-specific Vitest setup for `@tj/ui`. jest-dom matchers, the jsdom `localStorage`
 * fix and `cleanup()` come from the shared preset (`@tj/config/vitest/setup`); this file only
 * adds the controllable `matchMedia` mock the theme tests need.
 */
import { afterEach, beforeEach, vi } from "vitest";

/**
 * jsdom has no `window.matchMedia`. Provide a controllable mock so theme tests can flip OS
 * preferences via `setMatchMedia({ dark: true })` and fire `change` events with
 * `emitMatchMediaChange()`.
 */
type MediaState = { dark: boolean; moreContrast: boolean };
type ChangeListener = (event: MediaQueryListEvent) => void;

const mediaState: MediaState = { dark: false, moreContrast: false };
const listeners = new Map<string, Set<ChangeListener>>();

function matches(query: string): boolean {
  if (query.includes("prefers-color-scheme: dark")) return mediaState.dark;
  if (query.includes("prefers-contrast: more")) return mediaState.moreContrast;
  return false;
}

function createMatchMedia(query: string): MediaQueryList {
  const set = listeners.get(query) ?? new Set<ChangeListener>();
  listeners.set(query, set);
  const mql = {
    media: query,
    onchange: null,
    addEventListener: (_type: "change", cb: ChangeListener) => {
      set.add(cb);
    },
    removeEventListener: (_type: "change", cb: ChangeListener) => {
      set.delete(cb);
    },
    addListener: (cb: ChangeListener) => {
      set.add(cb);
    },
    removeListener: (cb: ChangeListener) => {
      set.delete(cb);
    },
    dispatchEvent: () => true,
    get matches() {
      return matches(query);
    },
  };
  return mql as unknown as MediaQueryList;
}

export function setMatchMedia(next: Partial<MediaState>): void {
  Object.assign(mediaState, next);
}

/** Notify every registered `change` listener with the current state. */
export function emitMatchMediaChange(): void {
  for (const [query, set] of listeners) {
    const event = { matches: matches(query), media: query } as MediaQueryListEvent;
    for (const cb of set) cb(event);
  }
}

beforeEach(() => {
  mediaState.dark = false;
  mediaState.moreContrast = false;
  listeners.clear();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.stubGlobal("matchMedia", vi.fn(createMatchMedia));
});

afterEach(() => {
  vi.unstubAllGlobals();
});
