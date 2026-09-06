import { test } from "./fixtures";

test("captures library card reference states", async ({ signedInPage: { page } }) => {
  await page.goto("/lessons");
  await page.locator("article").first().hover();
  await page.screenshot({ path: "/tmp/teach-90-grid-hover.png", fullPage: true });

  await page.getByRole("button", { name: "List" }).click();
  await page.screenshot({ path: "/tmp/teach-90-list.png", fullPage: true });

  await page.goto("/series");
  await page.screenshot({ path: "/tmp/teach-90-series.png", fullPage: true });

  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await page.screenshot({ path: "/tmp/teach-90-dark.png", fullPage: true });
});
