import type { Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, type SeededPaths, test } from "./fixtures";

/*
 * The worksheet editor on `/w/$worksheetId` (TEACH-109): rows 1, 2, 3, 7 and 9 of the acceptance
 * table with a real caret and a real pointer — typing into Tiptap, the slash menu from `/`, a drag
 * on the gutter handle, Print opening a new tab — where happy-dom cannot follow.
 */

const EDITOR = (paths: SeededPaths) => paths.worksheet("fraction-practice");
const blocks = (page: Page) => page.locator(".ws-column .ws-block");
const proseMirror = (page: Page) => page.locator(".ws-column .ProseMirror");

test.describe("worksheet editor", () => {
  test("row 1: the header, every block and Saved; page breaks as the print route makes them", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(page).toHaveTitle("Fractions practice · Teaching Journey");
    // The chrome's h1 and the sheet's own title both read "Fractions practice" (TEACH-186).
    await expect(
      page.getByRole("heading", { level: 1, name: "Fractions practice" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Sheet title" })).toHaveText(
      "Fractions practice",
    );
    await expect(blocks(page)).toHaveCount(9);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    // The same paginator as `/print`: the same number of pages.
    const editorPages = await page.locator(".ws-column .ws-page").count();
    await page.goto(paths.worksheet("fraction-practice", "/print"));
    await expect(page.locator(".ws-print-root")).toHaveCSS("visibility", "visible");
    expect(await page.locator(".ws-print-root .ws-page").count()).toBe(editorPages);
  });

  test("row 2: a typing burst is one undo step and autosaves", async ({
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
    // Pause past the idle window so the session closes, then undo: the whole burst goes.
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
    // Fifteen block types (headings twice) and the nine sections.
    await expect(list.getByRole("option")).toHaveCount(25);
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

  test("row 7: dragging the gutter handle of block 3 above block 1 reorders in one undo step", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(blocks(page)).toHaveCount(9);
    const ids = await blocks(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-block-id")),
    );
    const third = blocks(page).nth(2);
    await third.hover();
    const handle = third.getByRole("button", { name: "Drag to reorder this block" });
    const hb = await handle.boundingBox();
    const fb = await blocks(page).first().boundingBox();
    if (!hb || !fb) throw new Error("no geometry");
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x, fb.y + 2, { steps: 8 });
    await expect(page.locator(".ws-drop-line")).toBeVisible();
    await page.mouse.up();
    const after = await blocks(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-block-id")),
    );
    expect(after.slice(0, 3)).toEqual([ids[2], ids[0], ids[1]]);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    const undone = await blocks(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-block-id")),
    );
    expect(undone).toEqual(ids);
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

  test("row 10: a lesson id on the worksheet route shows the wrong-kind page", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(`/w/${paths.id("demo-water-cycle")}`);
    await expect(page.getByText("This is a lesson")).toBeVisible();
    await page.getByRole("link", { name: "Open the lesson" }).click();
    await expect(page).toHaveURL(new RegExp(`${paths.lesson("demo-water-cycle")}$`));
    await page.goto(`/l/${paths.id("fraction-practice")}`);
    await expect(page.getByText("This is a worksheet")).toBeVisible();
  });
});
