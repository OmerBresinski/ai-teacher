import type { Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, type SeededPaths, test } from "./fixtures";

/*
 * Worksheet recipes (TEACH-183), rows 4, 5 and 7 of the acceptance table on the seeded sheet: the
 * "Add block" pill opens the dialog on Sections; Exit ticket appends as one undo step and focuses
 * its first block; `/exit` in the slash menu finds Exit ticket under Sections. The seeded sheet
 * has no lesson, so the cards show the placeholder build.
 */

const EDITOR = (paths: SeededPaths) => paths.worksheet("fraction-practice");
const blocks = (page: Page) => page.locator(".ws-column .ws-block");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Add a block" });
const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z";

test.describe("worksheet recipes", () => {
  test("row 4: Add block opens the dialog on Sections with nine cards, miniatures, minutes and chips", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(blocks(page)).toHaveCount(8);
    await expect(page.locator(".ws-column .ws-header .ws-meta")).toHaveText(
      /^\d+ marks · about \d+ min$/,
    );
    await page.getByRole("button", { name: "Add block" }).click();
    const d = dialog(page);
    await expect(d).toBeVisible();
    await expect(d.getByRole("tab", { name: "Sections" })).toHaveAttribute("aria-selected", "true");
    const cards = d.getByRole("list", { name: "Sections" }).locator(":scope > li");
    await expect(cards).toHaveCount(9);
    // Every card: a miniature that is a real page, and a minutes pill.
    await expect(d.locator(".ws-mini .ws-page")).toHaveCount(9);
    await expect(d.getByText(/^about \d+ min$/)).toHaveCount(9);
    for (const job of ["Starter", "Check", "Practise", "Homework", "Revise", "Assess"]) {
      await expect(d.getByRole("button", { name: job, exact: true })).toBeVisible();
    }
    await d.getByRole("button", { name: "Check", exact: true }).click();
    await expect(cards).toHaveCount(3);
    // The dialog arrives over a fade; axe reads contrast through it, so let the motion finish.
    await page.waitForTimeout(400);
    await expectNoSeriousA11yViolations(page, "/w/:id (Add a block open)");
    await page.keyboard.press("Escape");
    await expect(d).toBeHidden();
  });

  test("row 5: Exit ticket appends its blocks as one undo step and focuses the first", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(blocks(page)).toHaveCount(8);
    await page.getByRole("button", { name: "Add block" }).click();
    const d = dialog(page);
    // Keyboard only: Tab lands on the first card's button, Enter picks it.
    const exit = d.getByRole("button", { name: /^Exit ticket\./ });
    await exit.focus();
    await expect(exit).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(d).toBeHidden();
    await expect(blocks(page)).toHaveCount(13);
    // The first inserted block (a question) is selected and its editor has the caret.
    const first = blocks(page).nth(8);
    await expect(first.locator(".ws-selected-ring")).toBeVisible();
    await expect(first.locator(".ProseMirror")).toBeFocused();
    await expect(blocks(page).nth(11).locator(".ws-answerbox-label")).toHaveText(
      "One thing I learned",
    );
    await page.keyboard.press(undoKey);
    await expect(blocks(page)).toHaveCount(8);
  });

  test("row 6: the gutter plus opens the same dialog and inserts after that block", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(blocks(page)).toHaveCount(8);
    const ids = () =>
      blocks(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id")));
    const before = await ids();
    const second = blocks(page).nth(1);
    await second.hover();
    await second.getByRole("button", { name: "Insert a block below" }).click();
    const d = dialog(page);
    await expect(d).toBeVisible();
    await d.getByRole("button", { name: /^Matching\./ }).click();
    await expect(d).toBeHidden();
    const after = await ids();
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after.slice(-6)).toEqual(before.slice(-6));
    // Instructions, the matching block, the word bank and the placeholder, right after block 2.
    await expect(blocks(page).nth(3).locator(".ws-match")).toBeVisible();
    await expect(blocks(page).nth(4).locator(".ws-wordbank")).toBeVisible();
  });

  test("row 7: `/exit` in the slash menu lists Exit ticket under Sections", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(blocks(page)).toHaveCount(8);
    // An empty paragraph to type `/` into, from the dialog's Blocks tab.
    await page.getByRole("button", { name: "Add block" }).click();
    const d = dialog(page);
    await d.getByRole("tab", { name: "Blocks" }).click();
    await d.getByRole("button", { name: /^Paragraph/ }).click();
    await expect(blocks(page)).toHaveCount(9);
    const pm = page.locator(".ws-column .ProseMirror");
    await expect(pm).toBeFocused();
    await page.keyboard.type("/");
    const list = page.getByRole("listbox", { name: "Block types" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("group", { name: "Sections" }).getByRole("option")).toHaveCount(9);
    await page.getByRole("combobox", { name: "Filter blocks" }).fill("exit");
    const options = list.getByRole("option");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText("Exit ticket");
    await expect(list.getByRole("group", { name: "Sections" })).toBeVisible();
    await page.keyboard.press("Enter");
    // The empty paragraph is replaced by the five blocks: 8 - 1 + 5.
    await expect(blocks(page)).toHaveCount(13);
    await page.keyboard.press(undoKey);
    await expect(blocks(page)).toHaveCount(9);
  });
});
