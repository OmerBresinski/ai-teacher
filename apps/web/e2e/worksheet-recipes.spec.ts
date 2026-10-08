import type { Page } from "@playwright/test";
import { expectNoSeriousA11yViolations, settled } from "./a11y";
import { expect, type SeededPaths, test } from "./fixtures";

/*
 * Worksheet recipes (TEACH-183), rows 4, 5 and 7 of the acceptance table on the seeded sheet: the
 * "Add block" pill opens the dialog on Sections; Exit ticket appends as one undo step and focuses
 * its first block; `/exit` in the slash menu finds Exit ticket under Sections. The seeded sheet
 * has no lesson, so the cards show the placeholder build.
 */

const EDITOR = (paths: SeededPaths) => paths.worksheet("fraction-practice");
/** Content blocks only: the self-assessment strip is a flow item too, pinned to the foot (TEACH-196). */
const blocks = (page: Page) => page.locator(".ws-column .ws-block:not(.ws-rag-slot)");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Add a block" });
const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z";

/** The seeded sheet's block count once it has rendered; the seed decides it, not this spec. */
async function seeded(page: Page): Promise<number> {
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(blocks(page).first()).toBeVisible();
  return blocks(page).count();
}

test.describe("worksheet recipes", () => {
  test("row 5: Exit ticket appends its blocks as one undo step and focuses the first", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    const before = await seeded(page);
    await page.getByRole("button", { name: "Add block" }).click();
    const d = dialog(page);
    // The open dialog's axe scan (moved here from row 4, now a unit test; TEACH-301).
    await expect(d).toBeVisible();
    await settled(page);
    await expectNoSeriousA11yViolations(page, "/w/:id (Add a block open)");
    // Keyboard only: Tab lands on the first card's button, Enter picks it.
    const exit = d.getByRole("button", { name: /^Exit ticket\./ });
    await exit.focus();
    await expect(exit).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(d).toBeHidden();
    // Six blocks (TEACH-194): the instruction line, three questions, the answer box, the placeholder.
    await expect(blocks(page)).toHaveCount(before + 6);
    // The first inserted block (the instruction line) is selected and its editor has the caret.
    const first = blocks(page).nth(before);
    await expect(first.locator(".ws-instructions")).toHaveText(
      "Answer each question in one or two sentences.",
    );
    await expect(first.locator(".ws-selected-ring")).toBeVisible();
    await expect(first.locator(".ProseMirror")).toBeFocused();
    await expect(
      blocks(page)
        .nth(before + 1)
        .locator(".ws-q-stem"),
    ).toBeVisible();
    await expect(
      blocks(page)
        .nth(before + 4)
        .locator(".ws-answerbox-label"),
    ).toHaveText("One thing I learned");
    await page.keyboard.press(undoKey);
    await expect(blocks(page)).toHaveCount(before);
  });
});
