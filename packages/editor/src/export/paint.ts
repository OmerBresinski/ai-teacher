/**
 * Waiting for a slide to be fully painted (TeachDeck `lib/export/png.ts` `waitForSlidePaint`).
 * Shared by the print route (before `window.print()`) and, from E2, the PNG capture loop: fonts
 * *and* every image, then one more frame so the browser has painted what was measured.
 */

/** Set on `<html>` once the print route has painted, so a headless renderer can wait on it. */
export const CAPTURE_READY_ATTR = "data-capture-ready";

export async function waitForSlidePaint(root: ParentNode = document): Promise<void> {
  if (typeof document !== "undefined" && "fonts" in document) {
    try {
      await document.fonts.ready;
    } catch {
      /* Font loading API unavailable: carry on, the fallback face still paints. */
    }
  }
  const images = Array.from(root.querySelectorAll("img"));
  // A slide's own background is a CSS `background-image` (`SlideBackground`), invisible to the
  // `<img>` query; it announces its URL on `data-background-image` so it can be preloaded here.
  const backgrounds = Array.from(root.querySelectorAll<HTMLElement>("[data-background-image]"))
    .map((el) => el.dataset.backgroundImage)
    .filter((src): src is string => !!src);
  await Promise.all([
    ...images.map(async (img) => {
      if (img.complete) return;
      try {
        await img.decode();
      } catch {
        /* A broken image must not block the rest of the slide. */
      }
    }),
    ...backgrounds.map(async (src) => {
      const img = new Image();
      img.src = src;
      try {
        await img.decode();
      } catch {
        /* Same: a broken background must not block the print. */
      }
    }),
  ]);
  // One more frame so the browser has actually painted what we just measured.
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
