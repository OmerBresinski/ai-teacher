/** TEACH-183 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-183-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

test("captures Add a block on Sections, on Blocks, and a sheet after inserting Matching", async ({
  signedInPage: { page, paths },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  await page.goto(paths.worksheet("fraction-practice"));
  await expect(page.locator(".ws-column .ws-block")).toHaveCount(8);
  await page.getByRole("button", { name: "Add block" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a block" });
  await expect(dialog.locator(".ws-mini .ws-page")).toHaveCount(9);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-183-sections.png" });

  await dialog.getByRole("tab", { name: "Blocks" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/teach-183-blocks.png" });

  await dialog.getByRole("tab", { name: "Sections" }).click();
  await dialog.getByRole("button", { name: /^Matching\./ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".ws-column .ws-match")).toBeVisible();
  await page.locator(".ws-column .ws-match").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-183-matching-inserted.png" });
});
