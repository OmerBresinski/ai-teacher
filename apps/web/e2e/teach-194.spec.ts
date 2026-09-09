import type { Page } from "@playwright/test";
import { expect, type SeededPaths, test } from "./fixtures";

/*
 * TEACH-194 acceptance rows 1 to 3: the Blocks tab inserts a task block's default instruction
 * before it when none stands since the last heading (one undo step), lists True or false and
 * Sorting table under Questions, and the selected block shows an inline hint for a fault the
 * pupil could not act on (a matching block with two identical right sides).
 */

const EDITOR = (paths: SeededPaths) => paths.worksheet("fraction-practice");
const blocks = (page: Page) => page.locator(".ws-column .ws-block");
const UNDO = process.platform === "darwin" ? "Meta+z" : "Control+z";
const MATCHING_LINE =
  "Match each item on the left to one on the right. Write the letter in the box.";

/** Blocks > Matching from the gutter plus of block 2, the "Worked example" heading. */
async function insertMatchingAfterHeading(page: Page) {
  const heading = blocks(page).nth(1);
  await expect(heading).toContainText("Worked example");
  await heading.hover();
  await heading.getByRole("button", { name: "Insert a block below" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a block" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Blocks" }).click();
  await dialog.getByRole("button", { name: /^Matching/ }).click();
  await expect(dialog).toBeHidden();
}

test.describe("TEACH-194 block guides", () => {
  test("row 1: Matching after a heading gets the guide's instruction before it; one undo removes both", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(blocks(page)).toHaveCount(9);
    await insertMatchingAfterHeading(page);
    await expect(blocks(page)).toHaveCount(11);
    await expect(blocks(page).nth(2)).toContainText(MATCHING_LINE);
    await expect(blocks(page).nth(3).locator(".ws-match-row").first()).toBeVisible();
    await page.keyboard.press(UNDO);
    await expect(blocks(page)).toHaveCount(9);
    await expect(page.locator(".ws-column")).not.toContainText(MATCHING_LINE);
  });

  test("row 2: True or false and Sorting table sit under Questions with their lines", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await page.getByRole("button", { name: "Add block" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a block" });
    await dialog.getByRole("tab", { name: "Blocks" }).click();
    const questions = dialog.locator('section[aria-label="Questions"]');
    await expect(questions.getByRole("button", { name: /^True or false/ })).toContainText(
      "A statement with True and False to tick",
    );
    await expect(questions.getByRole("button", { name: /^Sorting table/ })).toContainText(
      "Two columns with headings, items to sort",
    );
    await expect(dialog.getByRole("button", { name: /^Word bank/ })).toContainText(
      "Words to use in the fill-the-gap sentences below it",
    );
  });

  test("row 3: a matching block with two identical right sides shows the duplicate inline", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await insertMatchingAfterHeading(page);
    const matching = blocks(page).nth(3);
    await expect(matching.locator(".ws-match-row").first()).toBeVisible();
    await expect(matching.locator(".ws-warning")).toHaveCount(0);
    await matching.getByRole("textbox", { name: "Match A" }).fill("Rodent");
    await matching.getByRole("textbox", { name: "Match B" }).fill("Rodent");
    await expect(matching.locator(".ws-warning")).toContainText(
      "“Rodent” appears twice on the right",
    );
    // Only the selected block carries the hint; the sheet's other blocks show none.
    await expect(page.locator(".ws-column .ws-warning")).toHaveCount(1);
  });
});
