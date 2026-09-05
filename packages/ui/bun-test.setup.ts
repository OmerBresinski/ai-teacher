/**
 * Workspace-specific `bun test` preload for `@tj/ui`. jest-dom matchers, happy-dom and `cleanup()`
 * come from the shared preloads (`@tj/config/bun-test/{dom,setup}`); this file only adds the
 * controllable `matchMedia` mock the theme tests need. It is also imported by
 * `theme-provider.test.tsx` for `setMatchMedia` / `emitMatchMediaChange` — the module is shared
 * with the preload instance, so the hooks below are registered exactly once.
 */
import { afterEach, beforeEach, mock } from "bun:test";

/**
 * happy-dom's `window.matchMedia` is static. Provide a controllable mock so theme tests can flip
 * OS preferences via `setMatchMedia({ dark: true })` and fire `change` events with
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

// `vi.stubGlobal` / `vi.unstubAllGlobals` equivalent: swap the global by hand and restore it.
const originalMatchMedia = globalThis.matchMedia;

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class PointerEventMock extends MouseEvent {}

const originalResizeObserver = globalThis.ResizeObserver;
const originalPointerEvent = globalThis.PointerEvent;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  mediaState.dark = false;
  mediaState.moreContrast = false;
  listeners.clear();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  globalThis.matchMedia = mock(createMatchMedia);
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  globalThis.PointerEvent = PointerEventMock as unknown as typeof PointerEvent;
  HTMLElement.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  globalThis.matchMedia = originalMatchMedia;
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.PointerEvent = originalPointerEvent;
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});
