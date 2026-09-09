/** TEACH-196 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-196-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

test("captures a seeded sheet's foot in print view and the header toolbar with the moved control", async ({
  signedInPage: { page, paths },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  await page.goto(paths.worksheet("fraction-practice", "/print"));
  const root = page.locator(".ws-print-root");
  await expect(root).toHaveCSS("visibility", "visible");
  await expect(root.locator(".ws-rag-heading")).toHaveText("Tick what you can do now");
  await page.waitForTimeout(500);
  await root.locator(".ws-page", { has: root.locator(".ws-rag") }).screenshot({
    path: "/tmp/teach-196-print-foot.png",
  });

  await page.goto(paths.worksheet("fraction-practice"));
  await expect(page.locator(".ws-column .ws-page").first()).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.locator(".ws-column .ws-header").getByText("Name", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Criterion" })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-196-header-toolbar.png" });

  // The strip in edit mode with a fresh blank line and its placeholder.
  await page.getByRole("button", { name: "Criterion" }).click();
  const field = page.locator('.ws-column [data-block-id="__rag__"]').getByRole("textbox").last();
  await expect(field).toBeFocused();
  await field.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-196-strip-edit.png" });
});
