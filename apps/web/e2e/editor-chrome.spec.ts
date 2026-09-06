import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * The editor's contextual chrome (TEACH-105): the slide and element toolbars route with the
 * selection, a rail insert lands a selected element, the theme dialog switches the deck's theme,
 * and the More drawer's opacity slider is one undo step per drag.
 */

const EDITOR = "/l/demo-water-cycle";
const elements = (page: Page) => page.locator("[data-slide-frame] [data-element-id]");

async function clickAt(page: Page, target: ReturnType<Page["locator"]>) {
  const b = await target.boundingBox();
  if (!b) throw new Error("not on screen");
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

test.describe("editor chrome", () => {
  test("nothing selected shows the Slide toolbar; a selected text box swaps it for Text", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    await expect(page.getByRole("toolbar", { name: "Slide" })).toBeVisible();
    await clickAt(page, elements(page).filter({ hasText: "The water cycle" }).first());
    await expect(page.getByRole("toolbar", { name: "Text" })).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Slide" })).toHaveCount(0);
    // The bar never covers the words it edits, and never rides nearer the top than 72px.
    const bar = await page.getByRole("toolbar", { name: "Text" }).boundingBox();
    const title = await elements(page).filter({ hasText: "The water cycle" }).first().boundingBox();
    if (!bar || !title) throw new Error("no layout");
    const overlaps = bar.y < title.y + title.height && bar.y + bar.height > title.y;
    expect(overlaps).toBe(false);
    expect(bar.y).toBeGreaterThanOrEqual(72);
  });

  test("row 7: the rail inserts a shape and a line, each selected at the slide centre", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    await expect(elements(page).first()).toBeVisible();
    const count = await elements(page).count();
    await page
      .getByRole("toolbar", { name: "Insert" })
      .getByRole("button", { name: "Shape" })
      .click();
    await page.getByRole("menuitem", { name: "Rectangle" }).click();
    await expect(elements(page)).toHaveCount(count + 1);
    await expect(page.getByRole("toolbar", { name: "Shape" })).toBeVisible();
    await expect(page.locator("[data-selection-frame]")).toBeVisible();
    const shape = await elements(page).last().boundingBox();
    const slide = await page.locator("[data-slide-frame]").boundingBox();
    if (!shape || !slide) throw new Error("no layout");
    expect(Math.abs(shape.x + shape.width / 2 - (slide.x + slide.width / 2))).toBeLessThan(2);

    await page
      .getByRole("toolbar", { name: "Insert" })
      .getByRole("button", { name: "Line" })
      .click();
    await page.getByRole("menuitem", { name: "Arrow" }).click();
    await expect(elements(page)).toHaveCount(count + 2);
    await expect(page.getByRole("toolbar", { name: "Line" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Arrows, Arrow at the end/ })).toBeVisible();
  });

  test("row 1: a shape's fill changes from the palette; the opacity slider drag is one undo step", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    await page
      .getByRole("toolbar", { name: "Insert" })
      .getByRole("button", { name: "Shape" })
      .click();
    await page.getByRole("menuitem", { name: "Rectangle" }).click();
    const bar = page.getByRole("toolbar", { name: "Shape" });
    await bar.getByRole("button", { name: "Fill" }).click();
    const swatches = page.getByRole("dialog", { name: "Fill" }).getByRole("button", { name: /^#/ });
    const target = await swatches.nth(4).getAttribute("aria-label");
    await swatches.nth(4).click();
    const shape = elements(page).last();
    await expect
      .poll(async () => shape.locator("svg [fill]").first().getAttribute("fill"))
      .toBe(target);

    await bar.getByRole("button", { name: "More" }).click();
    const slider = page.getByRole("slider", { name: "Opacity" });
    await expect(slider).toBeVisible();
    // A pointer drag on the thumb: many value changes, one commit on release.
    const thumb = await slider.boundingBox();
    if (!thumb) throw new Error("no thumb");
    const cx = thumb.x + thumb.width / 2;
    const cy = thumb.y + thumb.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(cx - i * 5, cy);
    await page.mouse.up();
    const now = Number(await slider.getAttribute("aria-valuenow"));
    expect(now).toBeLessThan(100);
    await expect
      .poll(() => shape.evaluate((n) => (n as HTMLElement).style.opacity))
      .toBe(String(now / 100));
    await page.keyboard.press("Escape");
    // Fill, then the whole opacity run: two undo steps.
    const undo = page.getByRole("button", { name: "Undo" });
    await undo.click();
    await expect.poll(() => shape.evaluate((n) => (n as HTMLElement).style.opacity)).toBe("1");
    await undo.click();
    await expect
      .poll(async () => shape.locator("svg [fill]").first().getAttribute("fill"))
      .not.toBe(target);
  });

  test("row 8: the theme dialog switches to Playground and the canvas follows", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    const root = page.locator("[data-slide-frame] [data-slide-root]");
    const before = await root.evaluate((n) => getComputedStyle(n).backgroundColor);
    await page.getByRole("button", { name: "Theme" }).click();
    const dialog = page.getByRole("dialog", { name: "Theme" });
    await expect(dialog.getByRole("radio")).toHaveCount(6);
    await dialog.getByRole("radio", { name: "Playground" }).click();
    await expect(dialog.getByRole("radio", { name: "Playground" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect
      .poll(() => root.evaluate((n) => getComputedStyle(n).backgroundColor))
      .not.toBe(before);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("row 10: Escape closes a popover without deselecting", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    await page
      .getByRole("toolbar", { name: "Insert" })
      .getByRole("button", { name: "Shape" })
      .click();
    await page.getByRole("menuitem", { name: "Rectangle" }).click();
    await page
      .getByRole("toolbar", { name: "Shape" })
      .getByRole("button", { name: "Label" })
      .click();
    await expect(page.getByRole("textbox", { name: "Label" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: "Label" })).toHaveCount(0);
    await expect(page.locator("[data-selection-frame]")).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Shape" })).toBeVisible();
  });
});
