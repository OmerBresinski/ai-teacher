import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * The editor's top bar at school-laptop widths: Present and the lesson title stay on screen and
 * clickable, the bar keeps its one 48px row, and nothing in it runs past the right edge. Lower
 * priority actions fold into More instead.
 */

const WIDTHS = [1024, 1280, 1440] as const;

async function expectInsideViewport(page: Page, target: ReturnType<Page["locator"]>) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  if (!box) throw new Error("not laid out");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  return box;
}

test.describe("editor top bar at narrow widths", () => {
  for (const width of WIDTHS) {
    test(`at ${width}px Present and the title stay visible and Present opens present mode`, async ({
      signedInPage: { page, paths },
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(paths.lesson("demo-water-cycle"));
      const bar = page.locator("[data-topbar]");
      await expect(bar).toBeVisible();
      // Deterministic worst case: the web font has swapped in, and the save label reads its
      // longest ("Unsaved changes"), which it does for a moment after any edit or load-time fix.
      // Measuring whichever label happened to show made this flaky at 1024.
      await page.evaluate(() => document.fonts.ready);
      await bar.locator("[data-save-state]").evaluate((el) => {
        const label = el.lastChild;
        if (label?.nodeType === Node.TEXT_NODE) label.textContent = "Unsaved changes";
      });
      await expect(bar.locator("[data-save-state]")).toHaveText("Unsaved changes");

      await expectInsideViewport(page, bar.getByRole("button", { name: "Rename lesson" }));
      const present = bar.getByRole("button", { name: "Present", exact: true });
      const box = await expectInsideViewport(page, present);

      // One row, and nothing clipped or pushing the page sideways.
      expect((await bar.boundingBox())?.height).toBe(48);
      const overflow = await bar.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const pageOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(pageOverflow).toBeLessThanOrEqual(0);

      // A real click where the button is drawn, not a scrolled-into-view one.
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page).toHaveURL(/\/present/);
    });
  }
});
