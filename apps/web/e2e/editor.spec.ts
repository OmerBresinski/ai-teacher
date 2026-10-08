import type { Locator, Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, type SeededPaths, test } from "./fixtures";

/*
 * The lesson editor on `/l/$lessonId` (TEACH-103), its critical workflows: the editor opens with
 * every slide and Saved (row 1), slides reorder (row 9), and a rename autosaves to the library
 * (row 11). The other rows were cut to keep e2e to the critical journeys (8 Oct 2026).
 */

const EDITOR = (paths: SeededPaths) => paths.lesson("demo-water-cycle");

const frame = (page: Page) => page.locator("[data-slide-frame]");
const rows = (page: Page) => page.getByRole("listbox", { name: "Slides" }).getByRole("option");

async function centre(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** Playwright `mouse.down / move×steps / up`, the way a hand does it. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  steps = 10,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
  }
  await page.mouse.up();
}

test.describe("lesson editor", () => {
  test("row 1: the editor opens with the title, every slide in the navigator, slide 1 at fit and Saved", {
    tag: "@smoke",
  }, async ({ signedInPage: { page, paths } }) => {
    await page.goto("/lessons");
    await page.getByRole("link", { name: "Open The water cycle" }).click();
    await expect(page).toHaveURL(new RegExp(`${EDITOR(paths)}$`));
    await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();
    await expect(page).toHaveTitle("The water cycle · DayBack");

    const count = await rows(page).count();
    expect(count).toBe(7);
    await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
    // One full-size slide at fit: it sits inside the canvas with the 40px gutter on each side.
    const canvas = await page.getByRole("group", { name: "Slide canvas" }).boundingBox();
    const slide = await frame(page).boundingBox();
    if (!canvas || !slide) throw new Error("no layout");
    expect(Math.abs(slide.width / slide.height - 16 / 9)).toBeLessThan(0.02);
    expect(slide.width).toBeLessThanOrEqual(canvas.width - 80 + 1);
    expect(slide.height).toBeLessThanOrEqual(canvas.height - 80 + 1);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await expectNoSeriousA11yViolations(page, "/l/:id");
  });

  test("row 9: ⌘↓ moves slide 2 down; dragging slide 1 below slide 3 reorders", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(rows(page)).toHaveCount(7);
    const label = (i: number) => rows(page).nth(i).getAttribute("aria-label");
    const second = await label(1);
    const third = await label(2);

    await rows(page).nth(1).click();
    await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Meta+ArrowDown");
    await expect(rows(page).nth(1)).toHaveAttribute(
      "aria-label",
      third?.replace("Slide 3", "Slide 2") ?? "",
    );
    await expect(rows(page).nth(2)).toHaveAttribute(
      "aria-label",
      second?.replace("Slide 2", "Slide 3") ?? "",
    );
    await page.keyboard.press("Meta+ArrowUp");
    await expect(rows(page).nth(1)).toHaveAttribute("aria-label", second ?? "");

    // Pointer: slide 1 to below slide 3.
    const first = await label(0);
    const from = await centre(rows(page).nth(0));
    const target = await rows(page).nth(2).boundingBox();
    if (!target) throw new Error("no row");
    await drag(page, from, 0, target.y + target.height - from.y, 8);
    await expect(rows(page).nth(2)).toHaveAttribute(
      "aria-label",
      first?.replace("Slide 1", "Slide 3") ?? "",
    );
    await expect(rows(page).nth(0)).toHaveAttribute(
      "aria-label",
      second?.replace("Slide 2", "Slide 1") ?? "",
    );
  });

  test("row 11: renaming the title autosaves and the library card shows it", {
    tag: "@smoke",
  }, async ({ signedInPage: { page } }) => {
    await page.goto("/lessons");
    await page.getByRole("link", { name: "Open The water cycle" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();

    await page.getByRole("button", { name: "Rename lesson" }).click();
    const input = page.getByRole("textbox", { name: "Lesson title" });
    await input.fill("Rain, rivers and seas");
    await input.press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: "Rain, rivers and seas" }),
    ).toBeVisible();
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });

    // Back to the library: the card has the new title from the api.
    await page.getByRole("button", { name: "Back to library" }).click();
    await expect(page).toHaveURL(/\/lessons$/);
    await expect(page.getByRole("link", { name: "Open Rain, rivers and seas" })).toBeVisible();
  });
});
