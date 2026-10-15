/*
 * The icon library, loaded on demand (TEACH-310 part c, #527 review). The drawings are about
 * 48 KB gzipped, so code that reaches the browser never imports them statically (lazy.test.ts).
 * A layout asks `iconsLoaded()`: null until the library is here, and then it draws a same-size
 * placeholder (the medal without its drawing, so nothing shifts) and calls `loadIcons()`, so the
 * next layout has the drawings. A server that lays out slides imports `@tj/slides/icons`
 * statically and hands it over with `provideIcons`, so its slides always carry their icons.
 * Matching (`./match`) needs no drawings and may be imported statically.
 */
export type IconLibraryModule = typeof import("./index");

let loaded: IconLibraryModule | null = null;
let pending: Promise<IconLibraryModule> | null = null;

/** The library if it is loaded, else null (never waits). */
export const iconsLoaded = (): IconLibraryModule | null => loaded;

/** Loads the library once; later calls share the same promise. */
export function loadIcons(): Promise<IconLibraryModule> {
  pending ??= import("./index").then((m) => {
    loaded = m;
    return m;
  });
  return pending;
}

/** Hands over a library imported statically (servers, tests), so layouts draw at once. */
export function provideIcons(m: IconLibraryModule): void {
  loaded = m;
  pending ??= Promise.resolve(m);
}

/** Tests only: forget the library, as a page that has not loaded it yet. */
export function unloadIconsForTests(): void {
  loaded = null;
  pending = null;
}
