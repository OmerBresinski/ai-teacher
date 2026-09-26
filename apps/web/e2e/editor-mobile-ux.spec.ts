import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const PREVIEW = "/dev/first-experience";

async function openGenerating(page: Page) {
  await page.goto(PREVIEW);
  await page.getByRole("button", { name: "Skip planning" }).click();
  await page.getByRole("button", { name: "Just the slides" }).click();
  return page.getByTestId("creation-generating");
}

test("mobile generation becomes a scrollable lesson and opens a contextual editor", async ({
  signedInPage: { page },
}) => {
  test.setTimeout(55_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const preview = await openGenerating(page);
  const list = page.locator("[data-mobile-lesson-list]");

  await expect(preview).toHaveAttribute("data-preview-state", "empty");
  await expect(list).toBeVisible();
  await expect(page.locator("[data-mobile-loading-slot]")).toBeVisible();
  await page.screenshot({ path: "/tmp/first-experience-mobile-editor-loading.png" });

  await expect(preview).toHaveAttribute("data-preview-state", "ready", { timeout: 30_000 });
  await expect(page.locator("[data-mobile-slide]")).toHaveCount(7);
  await expect(page.locator("[data-mobile-slide]").last()).toBeInViewport();
  await page.screenshot({ path: "/tmp/first-experience-mobile-editor-overview.png" });

  const edit = page.getByRole("button", { name: "Edit slide 7" });
  await edit.click();
  await expect(page.locator("[data-mobile-editor-focus]")).toBeVisible();
  await expect(page.locator("[data-slide-frame]")).toHaveCount(1);
  await page.screenshot({ path: "/tmp/first-experience-mobile-editor-focus.png" });
});

test("mobile editing keeps one canvas, contextual sheets, and its return position", async ({
  signedInPage: { page, paths },
}) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(paths.lesson("demo-water-cycle"));
  const list = page.locator("[data-mobile-lesson-list]");
  const edit = page.getByRole("button", { name: "Edit slide 7" });
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const before = await list.evaluate((element) => element.scrollTop);
  await edit.click();

  const focused = page.locator("[data-mobile-editor-focus]");
  await expect(focused).toBeVisible();
  await expect(page.locator("[data-slide-frame]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Done" })).toBeFocused();
  await page.getByRole("button", { name: "Slide settings" }).click();
  const settings = page.getByRole("dialog", { name: "Slide settings" });
  await expect(settings).toBeVisible();
  await page.screenshot({ path: "/tmp/first-experience-mobile-slide-settings.png" });
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await page.getByRole("button", { name: "Slide settings" }).click();

  await settings.getByRole("button", { name: "Duplicate slide" }).click();
  await expect(page.locator("[data-mobile-slide]")).toHaveCount(8);
  await settings.getByRole("button", { name: "Delete slide" }).click();
  await expect(page.locator("[data-mobile-slide]")).toHaveCount(7);
  await settings.getByRole("button", { name: "Add slide after" }).click();
  await page.getByRole("menu", { name: "Slide kinds" }).getByRole("menuitem").first().click();
  await expect(page.locator("[data-mobile-slide]")).toHaveCount(8);
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "Slide settings" })).toHaveCount(0);
  await expect(focused).toBeVisible();

  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Insert into slide" })).toBeVisible();
  await page.screenshot({ path: "/tmp/first-experience-mobile-insert-sheet.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Insert into slide" })).toHaveCount(0);
  await expect(focused).toBeVisible();

  await page.getByRole("button", { name: "More lesson actions" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-mobile-slide]")).toHaveCount(7);

  await page.getByRole("button", { name: "Done" }).click();
  await expect(list).toBeVisible();
  await expect(edit).toBeFocused();
  expect(await list.evaluate((element) => element.scrollTop)).toBe(before);
});

test("phone and short landscape use cards while desktop keeps permanent rails", async ({
  signedInPage: { page, paths },
}) => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 740, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(paths.lesson("demo-water-cycle"));
    await expect(page.locator("[data-mobile-lesson-list]")).toBeVisible();
    await expect(page.locator("[data-navigator]")).toHaveCount(0);
    if (viewport.width === 375) {
      await page.screenshot({ path: "/tmp/first-experience-mobile-375-overview.png" });
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(paths.lesson("demo-water-cycle"));
  await expect(page.locator("[data-mobile-lesson-list]")).toHaveCount(0);
  await expect(page.locator("[data-navigator]")).toBeVisible();
  await expect(page.locator("[data-insert-rail]")).toBeVisible();
  await page.screenshot({ path: "/tmp/first-experience-editor-desktop-regression.png" });
});
