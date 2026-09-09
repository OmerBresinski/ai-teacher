/** TEACH-193 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-193-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

test("captures the Worksheets grid and a sheet header with Marks off", async ({
  signedInPage: { page, paths },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  await page.goto("/worksheets");
  await expect(page.locator("article .ws-thumb .ws-page")).toHaveCount(4);
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/teach-193-worksheets-grid.png" });

  await page.goto(paths.worksheet("river-vocabulary"));
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  // The Name / Date / Class strip: a click there selects the header without starting a text edit.
  await page
    .locator(".ws-column .ws-header")
    .first()
    .click({ position: { x: 24, y: 10 } });
  await expect(page.getByRole("switch", { name: "Marks" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-193-header-marks-off.png" });
});
