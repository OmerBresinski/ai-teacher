import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, test } from "./fixtures";

test.describe("library shell", () => {
  test("Home has the library navigation, create strip, and capped sections", async ({
    signedInPage: { page },
  }) => {
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Library" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Home/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Lessons/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Worksheets/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Series/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "New lesson" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lessons" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Worksheets" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Series" })).toBeVisible();
  });

  test("Lessons search survives reload and Escape clears it", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons");
    const search = page.getByRole("searchbox", { name: "Search by title" });
    await search.fill("water");
    await expect(page).toHaveURL(/\/lessons\?q=water$/);
    await expect(page.getByText("The water cycle")).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(1);
    await page.reload();
    await expect(search).toHaveValue("water");
    await search.press("Escape");
    await expect(page).toHaveURL(/\/lessons$/);
  });

  test("collapsed navigation persists after reload and exposes item tooltips", async ({
    signedInPage: { page },
  }) => {
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.getByRole("link", { name: "Lessons", exact: true }).hover();
    await expect(page.getByRole("tooltip", { name: "Lessons" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  });

  test("editor stubs return to the last library page", async ({ signedInPage: { page } }) => {
    await page.goto("/lessons");
    await expect(page.getByRole("heading", { name: "Lessons" })).toBeVisible();
    await page.goto("/l/demo-water-cycle");
    await expect(page.getByText("The editor arrives with @tj/editor")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Library" })).not.toBeVisible();
    await page.getByLabel("Back to the library").click();
    await expect(page).toHaveURL(/\/lessons$/);
  });

  test("Home, Lessons, and Series have no serious or critical axe findings in light and dark themes", async ({
    signedInPage: { page },
  }) => {
    await expectNoSeriousA11yViolations(page, "/");
    await page.goto("/lessons");
    await expect(page.getByRole("heading", { name: "Lessons" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/lessons");
    await page.goto("/series");
    await expect(page.getByRole("heading", { name: "Series" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/series");
    await page.getByRole("button", { name: "Theme" }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectNoSeriousA11yViolations(page, "/series (dark)");
  });
});
