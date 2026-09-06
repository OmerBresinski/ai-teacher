import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * In-place text editing on `/l/$lessonId` (TEACH-104): rows 1, 2, 7 and 9 of the acceptance table
 * with a real caret — double-click, type, Escape — where happy-dom cannot follow.
 */

const EDITOR = "/l/demo-water-cycle";
const elements = (page: Page) => page.locator("[data-slide-frame] [data-element-id]");
const proseMirror = (page: Page) => page.locator("[data-slide-frame] .ProseMirror");
const stage = (page: Page) => page.locator("[data-selection-layer]");

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const b = await locator.boundingBox();
  if (!b) throw new Error("not on screen");
  return b;
}

/** The rendered text block inside an element: the `td-rt` node, static or editable. */
const richText = (el: Locator) => el.locator(".td-rt").first();

/**
 * Elements sit under the transform layer's pointer catcher, so Playwright's own `dblclick()` waits
 * forever for them to "receive" the event; double-click where the element is, as a hand does.
 */
async function dblclickAt(page: Page, target: Locator) {
  const b = await box(target);
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
}

test.describe("text editing", () => {
  test("row 1: double-click opens a `td-rt` contenteditable in the same box, without a layout shift", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    const title = elements(page).filter({ hasText: "The water cycle" }).first();
    await expect(title).toBeVisible();
    const before = await box(richText(title));
    const glyphBefore = await box(title.getByText("The water cycle"));

    await dblclickAt(page, title);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    await expect(pm).toHaveAttribute("contenteditable", "true");
    await expect(pm).toHaveClass(/td-rt/);
    // Exactly one `td-rt` in the box now — the editor's; the static one is gone, not hidden under it.
    await expect(title.locator(".td-rt")).toHaveCount(1);

    const after = await box(pm);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
    const glyphAfter = await box(pm.getByText("The water cycle"));
    expect(Math.abs(glyphAfter.x - glyphBefore.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(glyphAfter.y - glyphBefore.y)).toBeLessThanOrEqual(1);
    // The selection frame stays, its handles do not.
    await expect(page.locator("[data-selection-frame]")).toBeVisible();
    await expect(page.locator("[data-handle]")).toHaveCount(0);
  });

  test("row 2: typing then Escape commits as one undo step and hands focus back to the canvas", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    const title = elements(page).filter({ hasText: "The water cycle" }).first();
    await dblclickAt(page, title);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" abc");
    // Live: the canvas re-renders each keystroke, and the thumbnail follows.
    await expect(pm).toContainText("The water cycle abc");
    await expect(
      page.getByRole("listbox", { name: "Slides" }).getByRole("option").first(),
    ).toContainText("The water cycle abc");

    await page.keyboard.press("Escape");
    await expect(proseMirror(page)).toHaveCount(0);
    await expect(stage(page)).toBeFocused();
    await expect(title).toContainText("The water cycle abc");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });

    const undo = page.getByRole("button", { name: "Undo" });
    await undo.click();
    await expect(title).not.toContainText("abc");
    await expect(undo).toBeDisabled();
  });

  test("row 10: inside the editor, Delete and ⌘D edit text and never touch the element", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    const title = elements(page).filter({ hasText: "The water cycle" }).first();
    await expect(title).toBeVisible();
    const count = await elements(page).count();
    await dblclickAt(page, title);
    await expect(proseMirror(page)).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await expect(proseMirror(page)).toContainText("The water cycl");
    await page.keyboard.press("ControlOrMeta+d");
    expect(await elements(page).count()).toBe(count);
    await page.keyboard.press("Escape");
    expect(await elements(page).count()).toBe(count);
  });

  test("row 4: with the editor open, the toolbar's Bold acts on the selection and lands in the doc", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    const title = elements(page).filter({ hasText: "The water cycle" }).first();
    await dblclickAt(page, title);
    await expect(proseMirror(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    const bold = page.getByRole("toolbar", { name: "Text" }).getByRole("button", { name: "Bold" });
    await bold.click();
    await expect(bold).toHaveAttribute("aria-pressed", "true");
    await expect(proseMirror(page).locator("strong")).toContainText("The water cycle");
    await page.keyboard.press("Escape");
    await expect(title.locator("strong")).toContainText("The water cycle");
  });

  test("row 7: an option card's label edits in place and Escape commits", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    // Slide 6 is the true/false check with two option cards.
    await page.getByRole("listbox", { name: "Slides" }).getByRole("option").nth(5).click();
    const option = page.locator('[data-slide-frame] [data-element-type="option"]').first();
    await expect(option).toContainText("True");
    await dblclickAt(page, option);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    expect(await option.locator(".ProseMirror").count()).toBe(1);
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await page.keyboard.press("Escape");
    await expect(option).toContainText("True!");
  });

  test("row 9: the Why? panel edits in the answer state; Escape closes it", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    await page.getByRole("listbox", { name: "Slides" }).getByRole("option").nth(5).click();
    await page.getByRole("tab", { name: "Answer" }).click();
    const panel = page.locator("[data-explanation-panel]");
    await expect(panel).toBeVisible();
    await dblclickAt(page, panel);
    const field = page.getByRole("textbox", { name: "Why this is the answer" });
    await expect(field).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" Really.");
    await page.keyboard.press("Escape");
    await expect(field).toHaveCount(0);
    await expect(panel).toContainText("Really.");
    await expect(stage(page)).toBeFocused();
  });
});
