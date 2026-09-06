/** TEACH-105 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-105-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 900 } });

test("captures the slide toolbar, a shape toolbar with the More drawer, and the theme dialog", async ({
  signedInPage: { page },
}) => {
  await page.goto("/l/demo-water-cycle");
  await expect(page.getByRole("toolbar", { name: "Slide" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-105-slide-toolbar.png" });

  await page
    .getByRole("toolbar", { name: "Insert" })
    .getByRole("button", { name: "Shape" })
    .click();
  await page.getByRole("menuitem", { name: "Rounded" }).click();
  await expect(page.getByRole("toolbar", { name: "Shape" })).toBeVisible();
  await page.getByRole("toolbar", { name: "Shape" }).getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-105-shape-toolbar.png" });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Theme" }).click();
  await expect(page.getByRole("dialog", { name: "Theme" })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-105-theme-dialog.png" });
});
