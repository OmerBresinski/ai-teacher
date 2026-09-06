import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * The text fitting engine in the editor (TEACH-106): the lint badge, Tidy, and the fit migration
 * that runs once when a stale lesson is opened.
 */

const elements = (page: Page) => page.locator("[data-slide-frame] [data-element-id]");
const rows = (page: Page) => page.getByRole("listbox", { name: "Slides" }).getByRole("option");

async function dblclickAt(page: Page, target: ReturnType<Page["locator"]>) {
  await expect(target).toBeVisible();
  const b = await target.boundingBox();
  if (!b) throw new Error("not on screen");
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
}

test.describe("layout engine", () => {
  test("row 6: typing until a heading overruns the body flags the slide; Tidy fixes it in one undo step", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/l/demo-water-cycle");
    // Slide 5 (Explanation): a heading over a body paragraph.
    await rows(page).nth(4).click();
    const heading = elements(page).filter({ hasText: "The sun powers the whole cycle" }).first();
    await dblclickAt(page, heading);
    const pm = page.locator("[data-slide-frame] .ProseMirror");
    await expect(pm).toBeFocused();
    await page.keyboard.press("End");
    // Three long lines of heading push the auto-height box down over the body.
    await page.keyboard.type(
      " and the sun powers every part of the water cycle on every day of every year without fail",
    );
    // First Escape leaves the text editor (the box stays selected); the second deselects.
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-slide-frame] .ProseMirror")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-selection-frame]")).toHaveCount(0);

    const badge = rows(page).nth(4).locator("[data-lint-badge]");
    await expect(badge).toBeVisible({ timeout: 5_000 });
    await expect(badge).toHaveAccessibleName(/overlaps or does not fit/);

    // Nothing selected, so the slide toolbar is up: Tidy.
    await page
      .getByRole("toolbar", { name: "Slide" })
      .getByRole("button", { name: "Tidy slide" })
      .click();
    await expect(page.getByText(/^Tidied: /)).toBeVisible();
    await expect(badge).toHaveCount(0, { timeout: 5_000 });

    // One step: undo puts the overlap back (and the badge).
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(badge).toBeVisible({ timeout: 5_000 });
  });

  test("row 7: a lesson stored under the old floors is re-fitted once on open and stamped", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/l/electricity");
    await expect(page.getByRole("heading", { level: 1, name: "Simple circuits" })).toBeVisible();
    // The migration waits for fonts and an idle editor, then tidies the flagged slide once.
    await expect(page.getByText(/tidied to fit the new text sizes/)).toBeVisible({
      timeout: 10_000,
    });
    // It is one undo step, saved once.
    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeEnabled();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });
    // Undo restores the layout but keeps the stamp: leaving and coming back (client-side, so the
    // mock store is not reseeded) runs no second migration and shows no second toast.
    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Back to library" }).click();
    await expect(page).toHaveURL(/\/lessons$|\/$/);
    await page.getByRole("link", { name: "Open Simple circuits" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Simple circuits" })).toBeVisible();
    await page.waitForTimeout(1_500);
    await expect(page.getByText(/tidied to fit the new text sizes/)).toHaveCount(0);
    await expect(undo).toBeDisabled();
    await expect(elements(page).first()).toBeVisible();
  });
});
