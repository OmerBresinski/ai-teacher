import { expect, test } from "./fixtures";

test("capture TEACH-89 shell states", async ({ signedInPage: { page } }) => {
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await page.screenshot({ path: "/tmp/teach-89-home-light.png", fullPage: true });

  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await page.screenshot({ path: "/tmp/teach-89-home-dark.png", fullPage: true });

  await page.goto("/lessons");
  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByText("The water cycle")).toBeVisible();
  await page.screenshot({ path: "/tmp/teach-89-lessons-list.png", fullPage: true });

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.screenshot({ path: "/tmp/teach-89-sidebar-collapsed.png", fullPage: true });
});
