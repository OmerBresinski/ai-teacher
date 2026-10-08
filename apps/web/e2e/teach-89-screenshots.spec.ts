import { expect, test } from "./fixtures";

test("capture TEACH-89 shell states", async ({ signedInPage: { page } }) => {
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await page.screenshot({ path: "/tmp/teach-89-home-light.png", fullPage: true });

  // The theme is set only on /settings (TEACH-33 part a); set it the way the app stores it.

  await page.evaluate(() => localStorage.setItem("tj-theme", "dark"));

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "/tmp/teach-89-home-dark.png", fullPage: true });

  await page.goto("/lessons");
  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByText("The water cycle").first()).toBeVisible();
  await page.screenshot({ path: "/tmp/teach-89-lessons-list.png", fullPage: true });

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.screenshot({ path: "/tmp/teach-89-sidebar-collapsed.png", fullPage: true });
});
