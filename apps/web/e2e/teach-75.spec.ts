import type { Locator, Page } from "@playwright/test";
import { expect, type SeededPaths, test } from "./fixtures";

/*
 * Slide callouts (TEACH-75, UX ruling 84), rows 7 and 8 of the acceptance table with a real
 * caret and pointer: the seeded demo's content slide carries a "WATCH OUT" card whose three
 * elements are ordinary elements — the text edits in place, the card deletes on its own and
 * comes back on undo, and present and print show the card because they render elements.
 */

const EDITOR = (paths: SeededPaths) => paths.lesson("demo-water-cycle");
const CALLOUT_TEXT =
  "Clouds are tiny drops of liquid water, not water vapour; vapour is invisible.";

const elements = (page: Page) => page.locator("[data-slide-frame] [data-element-id]");
const proseMirror = (page: Page) => page.locator("[data-slide-frame] .ProseMirror");
const rows = (page: Page) => page.getByRole("listbox", { name: "Slides" }).getByRole("option");

async function centre(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** Open the demo's content slide (slide 5) and wait for the callout to be on the stage. */
async function openContentSlide(page: Page, paths: SeededPaths) {
  await page.goto(EDITOR(paths));
  await expect(rows(page).nth(4)).toHaveAttribute("aria-label", "Slide 5, Explanation");
  await rows(page).nth(4).click();
  await expect(elements(page).filter({ hasText: "WATCH OUT" })).toHaveCount(1);
  await expect(elements(page).filter({ hasText: CALLOUT_TEXT })).toHaveCount(1);
}

test.describe("slide callouts", () => {
  test("row 7: the callout text edits in place; the card deletes alone and undo restores it", async ({
    signedInPage: { page, paths },
  }) => {
    await openContentSlide(page, paths);
    const count = await elements(page).count();

    // Edit: double-click where the text is (elements sit under the pointer catcher), type at the
    // end, Escape commits.
    const text = elements(page).filter({ hasText: CALLOUT_TEXT }).first();
    const at = await centre(text);
    await page.mouse.dblclick(at.x, at.y);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" Ask the class.");
    await page.keyboard.press("Escape");
    await expect(pm).toHaveCount(0);
    await expect(
      elements(page).filter({ hasText: "vapour is invisible. Ask the class." }),
    ).toHaveCount(1);

    // Delete the card alone: the last shape on the slide (the other is the heading's hairline;
    // the four are appended after the recipe), clicked at its top-left inset where no text sits.
    const shapes = page.locator('[data-slide-frame] [data-element-id][data-element-type="shape"]');
    await expect(shapes).toHaveCount(2);
    const cardBox = (await centre(shapes.last())).box;
    await page.mouse.click(cardBox.x + 6, cardBox.y + 6);
    await expect(page.locator("[data-selection-frame]")).toBeVisible();
    await page.keyboard.press("Delete");
    await expect(elements(page)).toHaveCount(count - 1);
    await expect(shapes).toHaveCount(1);
    // The label and the text stay, as with the worked example's working card.
    await expect(elements(page).filter({ hasText: "WATCH OUT" })).toHaveCount(1);
    await expect(elements(page).filter({ hasText: "Ask the class." })).toHaveCount(1);

    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(elements(page)).toHaveCount(count);
    await expect(shapes).toHaveCount(2);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  });

  test("row 8: present and print carry the card", async ({ signedInPage: { page, paths } }) => {
    await page.goto(`${paths.lesson("demo-water-cycle", "/present")}?slide=5`);
    await page.getByRole("button", { name: "Stay in this window" }).click();
    const stage = page.locator('[data-slide-mode="present"]');
    await expect(stage).toHaveCount(1);
    await expect(page.getByRole("status").first()).toContainText("Slide 5 of");
    await expect(stage.getByText("WATCH OUT")).toBeVisible();
    await expect(stage.getByText(CALLOUT_TEXT)).toBeVisible();

    await page.goto(paths.lesson("demo-water-cycle", "/print"));
    await expect(page.getByText("WATCH OUT")).toBeVisible();
    await expect(page.getByText(CALLOUT_TEXT)).toBeVisible();
  });
});
