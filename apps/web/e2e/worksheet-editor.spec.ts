import type { Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, type SeededPaths, test } from "./fixtures";

/*
 * The worksheet editor on `/w/$worksheetId` (TEACH-109), its critical workflows with a real caret:
 * a typing burst is one undo step and autosaves (row 2), the slash menu from `/` inserts a
 * Question (row 3), and Print opens a new tab (row 9). The other rows were cut to keep e2e to the
 * critical journeys (8 Oct 2026).
 */

const EDITOR = (paths: SeededPaths) => paths.worksheet("fraction-practice");
/** Content blocks only: the self-assessment strip is a flow item too, pinned to the foot (TEACH-196). */
const blocks = (page: Page) => page.locator(".ws-column .ws-block:not(.ws-rag-slot)");
const proseMirror = (page: Page) => page.locator(".ws-column .ProseMirror");

test.describe("worksheet editor", () => {
  test("row 2: a typing burst is one undo step and autosaves", { tag: "@smoke" }, async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    const stem = blocks(page).locator(".ws-q-stem").first();
    await expect(stem).toBeVisible();
    const original = (await stem.textContent()) ?? "";
    await stem.click();
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" abc", { delay: 30 });
    await expect(pm).toHaveText(`${original} abc`);
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    // Idle window: pause past it so the session closes, then undo: the whole burst goes.
    await page.waitForTimeout(700);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(pm).toHaveText(original);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 3000 });
    // The store has the undone text: reload and read it back.
    await page.reload();
    await expect(blocks(page).locator(".ws-q-stem").first()).toHaveText(original);
  });

  test("row 3: `/` in an empty paragraph opens the slash menu; Question inserts a numbered block", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(blocks(page)).toHaveCount(9);
    const count = 9;
    // Insert a paragraph below the first block through the gutter, then type `/` into it.
    const first = blocks(page).first();
    await first.hover();
    await first.getByRole("button", { name: "Insert a block below" }).click();
    // The gutter + opens "Add a block" (TEACH-183); Blocks > Paragraph inserts an empty one.
    const dialog = page.getByRole("dialog", { name: "Add a block" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: "Blocks" }).click();
    await dialog.getByRole("button", { name: /^Paragraph/ }).click();
    await expect(dialog).toBeHidden();
    await expect(blocks(page)).toHaveCount(count + 1);
    const pm = proseMirror(page);
    await expect(pm).toBeFocused();
    await page.keyboard.type("/");
    const list = page.getByRole("listbox", { name: "Block types" });
    await expect(list).toBeVisible();
    // Fifteen block types (headings twice, True or false and Sorting table) and the nine sections.
    await expect(list.getByRole("option")).toHaveCount(27);
    // The popover arrives over a fade; axe reads contrast through it, so let the motion finish.
    await page
      .locator('[role="dialog"]')
      .last()
      .evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    await expectNoSeriousA11yViolations(page, "/w/:id (slash menu open)");
    await page.getByRole("combobox", { name: "Filter blocks" }).fill("question");
    await page.keyboard.press("Enter");
    // The empty paragraph was replaced by a question: same count, a new numbered stem with the
    // caret in it. Found by focus, not position: `pickFromSlash` deletes the paragraph before it
    // inserts after the paragraph's id, so the replacement lands at the end of the sheet rather
    // than in place (tech debt, TEACH-186 review); the old seed hid it because block 2 was q1.
    await expect(blocks(page)).toHaveCount(count + 1);
    await expect(proseMirror(page)).toBeFocused();
    const inserted = blocks(page).filter({ has: page.locator(".ProseMirror") });
    await expect(inserted.locator(".ws-q-no")).toHaveText(/^\d+\.$/);
    await expect(inserted.locator(".ws-lines .ws-line")).toHaveCount(2);
  });

  test("row 9: Print opens the print route with ?auto=1 in a new tab", async ({
    signedInPage: { page, paths },
  }) => {
    const context = page.context();
    await page.goto(EDITOR(paths));
    await expect(page.getByRole("button", { name: "Print" })).toBeEnabled();
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("button", { name: "Print" }).click(),
    ]);
    await tab.waitForLoadState();
    expect(new URL(tab.url()).pathname + new URL(tab.url()).search).toBe(
      `${paths.worksheet("fraction-practice", "/print")}?auto=1`,
    );
    await tab.close();
  });
});
