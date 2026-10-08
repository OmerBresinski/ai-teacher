/**
 * `/w/$worksheetId/print` (TEACH-108): the paginated sheet and `?auto=1` printing once. The seeded
 * `fraction-practice` worksheet ships without an answer key, so its absence is what can be
 * asserted here; the key itself is covered by `packages/editor/src/worksheet/sheet.test.tsx`.
 */
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, test } from "./fixtures";

declare global {
  interface Window {
    __prints?: number;
  }
}

test.describe("worksheet print route", () => {
  test("renders the demo worksheet as A4 pages with header, blocks and footer numbers", {
    tag: "@smoke",
  }, async ({ signedInPage: { page, paths } }) => {
    await page.goto(paths.worksheet("fraction-practice", "/print"));
    await expect(page).toHaveTitle("Fractions practice · DayBack");
    const pages = page.locator(".ws-print-root .ws-page");
    await expect(pages.first()).toBeVisible();
    // Pages appear once measured; the count settles when the fonts are in.
    await expect(page.locator(".ws-print-root")).toHaveCSS("visibility", "visible");
    const count = await pages.count();
    expect(count).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole("heading", { level: 1, name: "Fractions practice" })).toBeVisible();
    for (const label of ["Name", "Date", "Class"]) {
      await expect(pages.first().getByText(label, { exact: true })).toBeVisible();
    }
    await expect(pages.first().getByText(`Page 1 of ${count}`)).toBeVisible();
    await expect(pages.last().getByText(`Page ${count} of ${count}`)).toBeVisible();
    // Every block on exactly one page: the sheet has 9 blocks, six of them marked questions. The
    // self-assessment strip at the foot is a flow item of its own, not a block (TEACH-196).
    await expect(page.locator(".ws-print-root .ws-block:not(.ws-rag-slot)")).toHaveCount(9);
    await expect(page.locator(".ws-print-root .ws-marks")).toHaveCount(6);
    // No answer key when the sheet does not ask for one; no app chrome; no won't-fit hint.
    await expect(page.getByRole("heading", { level: 2, name: "Answer key" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Back to the library" })).toHaveCount(0);
    await expect(page.locator(".ws-print-hint")).toHaveCount(0);
    // A4 at 1:1 is 595pt = 793.33px wide.
    const box = await pages.first().boundingBox();
    expect(box && Math.abs(box.width - 793.33) < 1).toBe(true);
    await expectNoSeriousA11yViolations(page, "/w/:id/print");
  });

  test("?auto=1 calls window.print exactly once, after the fonts are ready", async ({
    signedInPage: { page, paths },
  }) => {
    await page.addInitScript(() => {
      window.__prints = 0;
      window.print = () => {
        window.__prints = (window.__prints ?? 0) + 1;
      };
    });
    await page.goto(`${paths.worksheet("fraction-practice", "/print")}?auto=1`);
    await expect(page.locator(".ws-print-root .ws-page").first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__prints)).toBe(1);
    const fontsReady = await page.evaluate(() =>
      document.fonts.ready.then(() => document.fonts.status),
    );
    expect(fontsReady).toBe("loaded");
    // Negative check: a second print call must not follow the first.
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__prints)).toBe(1);
  });
});
