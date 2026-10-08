import { expect, test } from "./fixtures";

test("captures library card reference states", async ({ signedInPage: { page } }) => {
  await page.goto("/lessons");
  await page.locator("article").first().hover();
  await page.screenshot({ path: "/tmp/teach-90-grid-hover.png", fullPage: true });

  await page.getByRole("button", { name: "List" }).click();
  await page.screenshot({ path: "/tmp/teach-90-list.png", fullPage: true });

  await page.goto("/series");
  await page.screenshot({ path: "/tmp/teach-90-series.png", fullPage: true });

  // The theme is set only on /settings (TEACH-33 part a); set it the way the app stores it.

  await page.evaluate(() => localStorage.setItem("tj-theme", "dark"));

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "/tmp/teach-90-dark.png", fullPage: true });
});
