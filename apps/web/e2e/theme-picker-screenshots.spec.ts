import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * Opt-in (TEACH_SCREENSHOTS=1, never in CI): the theme picker at every place a teacher picks a
 * theme, light, at 1440 and 390 wide. `PICKER_SHOTS` is the folder, `PICKER_VARIANTS` the variants
 * to shoot (comma-separated; "" for the build as it is). Writes `timings.json` beside the shots:
 * milliseconds from opening the picker until the previews in view are drawn, and until all are.
 */
const env = process.env as Record<string, string | undefined>;
const OUT = env.PICKER_SHOTS ?? "/tmp/theme-picker-shots";
const VARIANTS = (env.PICKER_VARIANTS ?? "").split(",");
const WIDTHS = [1440, 390];
const timings: Record<string, number | null> = {};

async function timePreviews(page: Page, key: string, start: number): Promise<void> {
  const tiles = page.locator("[data-theme-preview]");
  if ((await tiles.count()) === 0) return;
  await page.waitForFunction(() => {
    const all = [...document.querySelectorAll<HTMLElement>("[data-theme-preview]")];
    // In view = inside the picker's scrolling list, not just the window.
    const inView = all.filter((el) => {
      const r = el.getBoundingClientRect();
      const box = el.closest("[role=radiogroup]")?.getBoundingClientRect();
      const top = Math.max(0, box?.top ?? 0);
      const bottom = Math.min(window.innerHeight, box?.bottom ?? window.innerHeight);
      return r.bottom > top && r.top < bottom && r.width > 0;
    });
    return inView.length > 0 && inView.every((el) => el.dataset.ready === "true");
  });
  timings[`${key} in view`] = Date.now() - start;
  // Scroll every tile into view in turn, in the page (no round trips), until each has drawn.
  const scrolling = await page.evaluate(async () => {
    const t0 = performance.now();
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    for (const el of document.querySelectorAll<HTMLElement>("[data-theme-preview]")) {
      el.scrollIntoView({ block: "nearest" });
      while (el.dataset.ready !== "true") await frame();
    }
    await document.fonts.ready;
    return Math.round(performance.now() - t0);
  });
  timings[`${key} all`] = Date.now() - start;
  timings[`${key} scroll-through`] = scrolling;
  await tiles.first().scrollIntoViewIfNeeded();
}

for (const variant of VARIANTS) {
  for (const width of WIDTHS) {
    const tag = `${variant || "now"}-${width}`;
    const q = variant ? `?picker=${variant}` : "";

    test(`blank lesson picker ${tag}`, async ({ signedInPage: { page } }) => {
      mkdirSync(OUT, { recursive: true });
      await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
      await page.goto(`/lessons/new${q}`);
      await page.getByRole("button", { name: "Blank lesson" }).click();
      await page.getByLabel("Title").fill("The water cycle");
      const start = Date.now();
      await page.getByRole("button", { name: "Next" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      if (variant) await page.locator("[data-theme-preview]").first().waitFor();
      await timePreviews(page, `blank ${tag}`, start);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `blank-${tag}.png`) });
      const tile = page.locator("[data-theme-preview]").nth(2);
      if (await tile.count()) {
        await tile.hover();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(OUT, `blank-${tag}-hover.png`) });
      }
    });

    test(`editor theme picker ${tag}`, async ({ signedInPage: { page, paths } }) => {
      mkdirSync(OUT, { recursive: true });
      await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
      await page.goto(`${paths.lesson("demo-water-cycle")}${q}`);
      const callout = page.locator("[data-theme-callout]:visible").first();
      await callout.click();
      const start = Date.now();
      await expect(page.getByRole("dialog", { name: "Theme" })).toBeVisible();
      await timePreviews(page, `editor ${tag}`, start);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `editor-${tag}.png`) });
      const tile = page.locator("[data-theme-tile]").nth(4);
      if (await tile.count()) {
        await tile.focus();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(OUT, `editor-${tag}-focus.png`) });
      }
    });
  }
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `timings-${process.pid}.json`);
  writeFileSync(file, JSON.stringify(timings, null, 2));
});
