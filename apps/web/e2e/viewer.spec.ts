import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, test } from "./fixtures";

const status = (page: import("@playwright/test").Page) => page.getByRole("status");

test.describe("lesson viewer", () => {
  test("opens from a library card, shows every slide in the rail and walks the deck", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons");
    await page.getByRole("link", { name: "Open The water cycle" }).click();
    await expect(page).toHaveURL(/\/l\/demo-water-cycle$/);
    await expect(page).toHaveTitle("The water cycle · Teaching Journey");
    await expect(page.getByText("The water cycle").first()).toBeVisible();

    const rail = page.getByRole("navigation", { name: "Slides" });
    const thumbs = rail.getByRole("button", { name: /^Slide \d+$/ });
    const count = await thumbs.count();
    expect(count).toBeGreaterThanOrEqual(5);
    await expect(page.getByText(`${count} slides`)).toBeVisible();
    // One full-size slide on the canvas, 16:9.
    const canvas = page.locator('[data-slide-mode="view"]');
    await expect(canvas).toHaveCount(1);
    const box = await canvas.boundingBox();
    expect(box && Math.abs(box.width / box.height - 16 / 9) < 0.02).toBe(true);

    await expect(status(page)).toHaveText(`Slide 1 of ${count}`);
    await page.keyboard.press("ArrowRight");
    await expect(status(page)).toContainText("Slide 2 of");
    await page.keyboard.press("End");
    await expect(status(page)).toContainText(`Slide ${count} of`);
    await page.keyboard.press("Home");
    await expect(status(page)).toContainText("Slide 1 of");
    await thumbs.nth(2).click();
    await expect(status(page)).toContainText("Slide 3 of");
    await expect(thumbs.nth(2)).toHaveAttribute("aria-current", "true");

    await expectNoSeriousA11yViolations(page, "/l/demo-water-cycle");
  });

  test("Present opens present mode at the current slide; Back returns to the library", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons");
    await page.getByRole("link", { name: "Open The water cycle" }).click();
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "Present" }).click();
    await expect(page).toHaveURL(/\/l\/demo-water-cycle\/present\?slide=2$/);
    await page.goBack();
    await page.getByRole("button", { name: "Back to the library" }).click();
    await expect(page).toHaveURL(/\/lessons$/);
  });

  test("Make a copy creates a new lesson and opens it", async ({ signedInPage: { page } }) => {
    await page.goto("/l/demo-water-cycle");
    await page.getByRole("button", { name: "Make a copy" }).click();
    await expect(page).toHaveURL(/\/l\/(?!demo-water-cycle$)[\w-]+$/);
    await expect(page.getByText("Duplicated “The water cycle”")).toBeVisible();
    await expect(page.getByText("The water cycle (copy)").first()).toBeVisible();
    await page.goto("/lessons");
    // Sidebar count moved from the seeded 10 to 11 (the count is in the link's accessible name).
    await expect(page.getByRole("link", { name: /^Lessons\b/ })).toContainText("11");
  });

  test("a missing id is a 404", async ({ signedInPage: { page } }) => {
    await page.goto("/l/does-not-exist");
    await expect(page.getByText("Page not found")).toBeVisible();
  });
});
