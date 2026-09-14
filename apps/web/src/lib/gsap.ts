/**
 * Click-loaded GSAP (ADR 0028). GSAP drives the character hand-off animation ported from the
 * marketing site's vendored copy (`homepage/motion/vendor/gsap.min.js`, GSAP 3.14.2) into the
 * intake and generating views. It must never land in the app's initial chunk or an editor chunk
 * (`scripts/check-bundle-budget.ts`'s `CLICK_LOADED_CHUNKS`), so every caller reaches it through
 * `loadGsap()` — never a static `import ... from "gsap"`. `gsap.test.ts` greps `apps/web/src` to
 * enforce that; this file is the one allowed exception.
 */

/**
 * The click-loaded gsap import itself, as a swappable single-entry object — the same pattern
 * `packages/editor/src/export/ExportControl.tsx`'s `exportLoaders` uses: a unit test can replace
 * `gsapImport.gsap` with a stub thunk (to simulate a failed chunk load) and put it back, without
 * `mock.module`, which would leak into other files' tests in the same run. The `import()` call
 * stays literal so Vite still splits the chunk.
 */
export const gsapImport = {
  gsap: () => import("gsap"),
};

let gsapPromise: Promise<typeof import("gsap").gsap> | null = null;

/**
 * Loads gsap on first call and memoises the resolved instance for every later call, so repeat
 * scenes share one GSAP (and its ticker) instead of re-running setup. Runs
 * `gsap.config({ nullTargetWarn: false })` exactly once, the first time gsap loads — a scene whose
 * target has already left the DOM (a fast turn transition) should not warn.
 *
 * A failed load (a dropped chunk request, a flaky network) clears the cache and rethrows, so the
 * next call retries the dynamic import instead of replaying the same rejection forever.
 *
 * Call this from the interaction that starts a scene, not at module scope, so the dynamic
 * `import("gsap")` stays a separate chunk Vite loads only on demand.
 */
export function loadGsap(): Promise<typeof import("gsap").gsap> {
  if (!gsapPromise) {
    gsapPromise = gsapImport
      .gsap()
      .then(({ gsap }) => {
        gsap.config({ nullTargetWarn: false });
        return gsap;
      })
      .catch((err: unknown) => {
        gsapPromise = null;
        throw err;
      });
  }
  return gsapPromise;
}

/**
 * `prefers-reduced-motion: reduce` (ADR 0028). Every GSAP scene must check this and collapse its
 * timeline to a plain crossfade instead of the full choreography when it is true.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
